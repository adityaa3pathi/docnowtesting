'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    Loader2, MapPin, Calendar, TestTubes, Shield, Tag,
    Wallet, ChevronRight, AlertCircle, CheckCircle2, User,
    UserPlus, Check, Sparkles, Clock, ArrowLeft
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import toast from 'react-hot-toast';

interface CampDetail {
    id: string;
    name: string;
    description: string | null;
    location: string;
    city: string;
    pincode: string;
    startDate: string;
    endDate: string;
    price: number;
    items: {
        id: string;
        catalogItemId: string;
        catalogItem: {
            id: string;
            name: string;
            partnerCode: string;
            type: string;
        };
    }[];
}

interface Patient {
    id: string;
    name: string;
    relation: string;
    dob?: string;
    gender?: string;
    age?: number;
}

interface CheckoutResponse {
    bookingId: string;
    razorpayOrderId: string;
    amount: number;
    currency: string;
    keyId: string;
    status?: string;
}

// ── Helpers ──────────────────────────────────────────
function getCampStatus(start: string, end: string): { label: string; color: string; dot: string } {
    const now = new Date();
    const s = new Date(start);
    const e = new Date(end);
    if (now >= s && now <= e) return { label: 'Happening Now', color: 'bg-emerald-400/20 text-emerald-100 border-emerald-400/30', dot: 'bg-emerald-400 animate-pulse' };
    const diff = Math.ceil((s.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= 3) return { label: `Starts in ${diff}d`, color: 'bg-amber-400/20 text-amber-100 border-amber-400/30', dot: 'bg-amber-400' };
    return { label: 'Upcoming', color: 'bg-white/10 text-white/80 border-white/20', dot: 'bg-white/60' };
}

function formatDateLong(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getRelationLabel(relation: string) {
    const r = relation?.toLowerCase();
    if (!r || r === 'self') return 'Self';
    return r.charAt(0).toUpperCase() + r.slice(1);
}

// ── Main Component ──────────────────────────────────
export default function CampRegistrationPage() {
    const params = useParams();
    const router = useRouter();
    const { user, isAuthenticated, isInitialized } = useAuth();
    const campId = params.id as string;

    // Data state
    const [camp, setCamp] = useState<CampDetail | null>(null);
    const [patients, setPatients] = useState<Patient[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [selectedPatientId, setSelectedPatientId] = useState<string>('');
    const [dob, setDob] = useState('');
    const [promoCode, setPromoCode] = useState('');
    const [promoDiscount, setPromoDiscount] = useState(0);
    const [promoApplied, setPromoApplied] = useState(false);
    const [isVerifyingPromo, setIsVerifyingPromo] = useState(false);
    const [promoError, setPromoError] = useState('');
    const [useWallet, setUseWallet] = useState(false);
    const [walletBalance, setWalletBalance] = useState(0);
    const [isCheckingOut, setIsCheckingOut] = useState(false);

    // Redirect to login if not authenticated
    useEffect(() => {
        if (isInitialized && !isAuthenticated) {
            router.push(`/?login=true&redirect=/camps/${campId}`);
        }
    }, [isInitialized, isAuthenticated, router, campId]);

    // Fetch camp details + patients
    useEffect(() => {
        if (!isInitialized || !isAuthenticated) return;

        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // Ensure "Self" patient exists before fetching the list
                try { await api.post('/profile/patients/ensure-self'); } catch { /* profile may be incomplete */ }

                const [campRes, patientsRes] = await Promise.all([
                    api.get(`/camps/${campId}`),
                    api.get('/profile/patients'),
                ]);

                const campData = campRes.data.camp || campRes.data;
                setCamp(campData);

                // Sort: Self first, then alphabetical
                const allPatients: Patient[] = patientsRes.data || [];
                allPatients.sort((a, b) => {
                    const aIsSelf = a.relation?.toLowerCase() === 'self';
                    const bIsSelf = b.relation?.toLowerCase() === 'self';
                    if (aIsSelf && !bIsSelf) return -1;
                    if (!aIsSelf && bIsSelf) return 1;
                    return a.name.localeCompare(b.name);
                });
                setPatients(allPatients);

                // Default select Self patient (or first patient)
                const selfPatient = allPatients.find(p => p.relation?.toLowerCase() === 'self');
                const defaultPatient = selfPatient || allPatients[0];
                if (defaultPatient) {
                    setSelectedPatientId(defaultPatient.id);
                    if (defaultPatient.dob) {
                        setDob(defaultPatient.dob.split('T')[0]);
                    }
                }

                // Fetch wallet balance
                try {
                    const walletRes = await api.get('/wallet/balance');
                    setWalletBalance(walletRes.data.balance || 0);
                } catch {
                    // Wallet not available, ignore
                }
            } catch (err: any) {
                console.error('Failed to load camp data', err);
                setError(err.response?.data?.error || 'Failed to load camp details');
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [campId, isInitialized, isAuthenticated]);

    // Update DOB when patient changes
    const handlePatientChange = (patientId: string) => {
        setSelectedPatientId(patientId);
        const patient = patients.find(p => p.id === patientId);
        if (patient?.dob) {
            setDob(patient.dob.split('T')[0]);
        } else {
            setDob('');
        }
    };

    // Apply promo code
    const applyPromo = async () => {
        if (!promoCode.trim()) {
            toast.error('Please enter a promo code');
            return;
        }

        setIsVerifyingPromo(true);
        setPromoError('');
        try {
            const res = await api.post('/promos/verify', {
                code: promoCode.trim(),
                amount: camp?.price || 0,
            });
            setPromoDiscount(res.data.discountAmount || 0);
            setPromoApplied(true);
            toast.success(`Promo applied! You save ₹${res.data.discountAmount}`);
        } catch (err: any) {
            const msg = err.response?.data?.error || 'Invalid promo code';
            setPromoError(msg);
            setPromoDiscount(0);
            setPromoApplied(false);
            toast.error(msg);
        } finally {
            setIsVerifyingPromo(false);
        }
    };

    const removePromo = () => {
        setPromoCode('');
        setPromoDiscount(0);
        setPromoApplied(false);
        setPromoError('');
    };

    // Price calculations
    const basePrice = camp?.price || 0;
    const discountAmount = promoApplied ? promoDiscount : 0;
    const afterDiscount = Math.max(0, basePrice - discountAmount);
    const walletDeduction = useWallet ? Math.min(walletBalance, afterDiscount) : 0;
    const finalAmount = Math.max(0, afterDiscount - walletDeduction);

    // Load Razorpay script
    const loadRazorpayScript = (): Promise<void> => {
        return new Promise((resolve, reject) => {
            if ((window as any).Razorpay) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Razorpay'));
            document.body.appendChild(script);
        });
    };

    // Handle checkout
    const handleCheckout = async () => {
        if (!selectedPatientId) {
            toast.error('Please select a patient');
            return;
        }
        if (!dob) {
            toast.error('Please enter date of birth');
            return;
        }

        setIsCheckingOut(true);
        try {
            const checkoutRes = await api.post('/camps/checkout', {
                campId,
                patientId: selectedPatientId,
                dob,
                promoCode: promoApplied ? promoCode.trim() : undefined,
                useWallet,
            });

            const data: CheckoutResponse = checkoutRes.data;

            // If fully covered by wallet/promo, no payment needed
            if (data.status === 'confirmed' || data.amount === 0) {
                toast.success('Registration confirmed!');
                router.push('/bookings?tab=upcoming');
                return;
            }

            // Load Razorpay if not loaded
            if (!(window as any).Razorpay) {
                await loadRazorpayScript();
            }

            const options = {
                key: data.keyId,
                amount: data.amount,
                currency: data.currency,
                name: 'DocNow Healthcare',
                description: 'Camp Registration',
                order_id: data.razorpayOrderId,
                handler: async function (response: any) {
                    try {
                        setIsCheckingOut(true);
                        await api.post('/payments/verify', {
                            bookingId: data.bookingId,
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        });
                        toast.success('Registration confirmed!');
                        router.push('/bookings?tab=upcoming');
                    } catch (verifyError: any) {
                        console.error('Payment verification error:', verifyError);
                        toast.error('Payment verification failed. If amount was deducted, it will be refunded within 5-7 days.');
                    } finally {
                        setIsCheckingOut(false);
                    }
                },
                prefill: {
                    contact: user?.mobile || '',
                    email: user?.email || '',
                },
                theme: { color: '#4b2192' },
                modal: {
                    ondismiss: () => {
                        setIsCheckingOut(false);
                    },
                },
            };

            const rzp = new (window as any).Razorpay(options);
            rzp.open();
        } catch (error: any) {
            console.error('Checkout error:', error);
            toast.error(error.response?.data?.error || 'Failed to initiate checkout. Please try again.');
            setIsCheckingOut(false);
        }
    };

    const selectedPatient = patients.find(p => p.id === selectedPatientId);
    const isFormValid = !!selectedPatientId && !!dob;

    // Auth loading
    if (!isInitialized) {
        return (
            <div className="w-full min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="animate-spin w-8 h-8 text-[#4b2192]" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return null; // Will redirect
    }

    if (isLoading) {
        return <CampDetailSkeleton />;
    }

    if (error || !camp) {
        return (
            <div className="w-full min-h-screen bg-gray-50 flex items-center justify-center px-4">
                <div className="text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-8 max-w-md">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
                    <h2 className="text-lg font-bold text-gray-900 mb-2">Camp Not Found</h2>
                    <p className="text-gray-500 mb-6">{error || 'This camp may no longer be active.'}</p>
                    <button
                        onClick={() => router.push('/camps')}
                        className="bg-[#4b2192] text-white px-6 py-2.5 rounded-xl font-medium hover:bg-[#3d1a7a] transition-all active:scale-95"
                    >
                        Browse Camps
                    </button>
                </div>
            </div>
        );
    }

    const status = getCampStatus(camp.startDate, camp.endDate);

    return (
        <div className="w-full min-h-screen bg-gray-50 pb-32 md:pb-20">
            {/* ═══ Camp Header — Premium Gradient ═══ */}
            <div className="relative bg-gradient-to-br from-[#3a1278] via-[#4b2192] to-[#7c3aed] text-white overflow-hidden">
                {/* Decorative Elements */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/[0.03] rounded-full" />
                    <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-white/[0.02] rounded-full translate-y-1/2" />
                    <div className="absolute top-1/2 right-1/3 w-32 h-32 bg-purple-400/10 rounded-full" />
                </div>

                <div className="relative container mx-auto px-4 pt-6 pb-8 sm:pt-8 sm:pb-10 max-w-4xl">
                    {/* Back button */}
                    <button
                        onClick={() => router.back()}
                        className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white/90 transition-colors mb-5 -ml-1"
                    >
                        <ArrowLeft size={16} />
                        <span>Back</span>
                    </button>

                    {/* Status badge */}
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide border ${status.color} mb-4`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                        {status.label}
                    </div>

                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2 leading-tight">{camp.name}</h1>
                    {camp.description && (
                        <p className="text-white/60 text-sm sm:text-base mb-5 max-w-2xl leading-relaxed">{camp.description}</p>
                    )}

                    {/* Meta chips */}
                    <div className="flex flex-wrap gap-2 sm:gap-3">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm text-sm text-white/90">
                            <MapPin size={14} className="shrink-0" />
                            <span className="truncate">{camp.location}, {camp.city}</span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm text-sm text-white/90">
                            <Calendar size={14} className="shrink-0" />
                            <span>{formatDateLong(camp.startDate)} — {formatDateLong(camp.endDate)}</span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm text-sm text-white/90">
                            <TestTubes size={14} className="shrink-0" />
                            <span>{camp.items.length} tests included</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ Main Content ═══ */}
            <div className="container mx-auto px-3 sm:px-4 py-5 sm:py-8 max-w-4xl">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">

                    {/* ── Left Column ── */}
                    <div className="md:col-span-2 space-y-4 sm:space-y-5">

                        {/* ─ Included Tests ─ */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-50">
                                <h2 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                                    <div className="p-1.5 bg-purple-50 rounded-lg">
                                        <Shield size={16} className="text-[#4b2192]" />
                                    </div>
                                    Included Tests & Packages
                                    <span className="ml-auto text-xs font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{camp.items.length}</span>
                                </h2>
                            </div>
                            <div className="p-4 sm:p-5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    {camp.items.map(item => (
                                        <div
                                            key={item.id}
                                            className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-gray-50/80 border border-gray-100/80 hover:bg-purple-50/50 hover:border-purple-100/60 transition-colors"
                                        >
                                            <div className="p-1.5 bg-purple-100/60 rounded-lg shrink-0">
                                                <TestTubes size={14} className="text-[#4b2192]" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium text-gray-800 truncate">{item.catalogItem.name}</div>
                                                <div className="text-[11px] text-gray-400 uppercase tracking-wide font-medium">{item.catalogItem.type}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* ─ Patient Selection — Card-based ─ */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-50">
                                <h2 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                                    <div className="p-1.5 bg-purple-50 rounded-lg">
                                        <User size={16} className="text-[#4b2192]" />
                                    </div>
                                    Who is this for?
                                </h2>
                                <p className="text-xs text-gray-400 mt-1 ml-9">Select the patient registering for the camp</p>
                            </div>
                            <div className="p-4 sm:p-5 space-y-4">
                                {/* Patient cards */}
                                {patients.length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        {patients.map(patient => {
                                            const isSelected = selectedPatientId === patient.id;
                                            return (
                                                <button
                                                    key={patient.id}
                                                    type="button"
                                                    onClick={() => handlePatientChange(patient.id)}
                                                    className={`relative w-full text-left px-4 py-3.5 rounded-xl border-2 transition-all duration-200 ${
                                                        isSelected
                                                            ? 'border-[#4b2192] bg-purple-50/60 shadow-sm shadow-purple-100/50'
                                                            : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/50'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {/* Avatar */}
                                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
                                                            isSelected
                                                                ? 'bg-[#4b2192] text-white'
                                                                : 'bg-gray-100 text-gray-500'
                                                        }`}>
                                                            {getInitials(patient.name)}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-sm font-semibold text-gray-900 truncate">{patient.name}</div>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                                                                    isSelected ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'
                                                                }`}>
                                                                    {getRelationLabel(patient.relation)}
                                                                </span>
                                                                {patient.gender && (
                                                                    <span className="text-[11px] text-gray-400">{patient.gender === 'M' || patient.gender?.toLowerCase().startsWith('m') ? 'Male' : 'Female'}</span>
                                                                )}
                                                                {patient.age && (
                                                                    <span className="text-[11px] text-gray-400">{patient.age}y</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {/* Check indicator */}
                                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                                            isSelected
                                                                ? 'border-[#4b2192] bg-[#4b2192]'
                                                                : 'border-gray-200'
                                                        }`}>
                                                            {isSelected && <Check size={12} className="text-white" />}
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-6 px-4 rounded-xl bg-gray-50 border border-dashed border-gray-200">
                                        <UserPlus className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                                        <p className="text-sm text-gray-500 mb-1">No patients found</p>
                                        <p className="text-xs text-gray-400">Add a patient from your profile to register for this camp</p>
                                        <button
                                            onClick={() => router.push('/profile?tab=patients')}
                                            className="mt-3 text-sm font-semibold text-[#4b2192] hover:text-[#3d1a7a] transition-colors"
                                        >
                                            + Add Patient
                                        </button>
                                    </div>
                                )}

                                {/* DOB Input — only show if patient selected */}
                                {selectedPatientId && (
                                    <div className="pt-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                            Date of Birth
                                            {!dob && <span className="text-red-400 ml-1">*</span>}
                                        </label>
                                        <div className="relative">
                                            <input
                                                type="date"
                                                value={dob}
                                                onChange={(e) => setDob(e.target.value)}
                                                max={new Date().toISOString().split('T')[0]}
                                                className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] focus:bg-white transition-all text-sm"
                                            />
                                        </div>
                                        {selectedPatient?.dob && (
                                            <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                                                <Check size={12} className="text-green-500" />
                                                Auto-filled from patient profile
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ─ Promo Code ─ */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 sm:px-6 sm:py-5">
                                <h2 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
                                    <div className="p-1.5 bg-purple-50 rounded-lg">
                                        <Tag size={16} className="text-[#4b2192]" />
                                    </div>
                                    Promo Code
                                </h2>

                                {promoApplied ? (
                                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                                        <div className="flex items-center gap-2.5">
                                            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                                            <div>
                                                <div className="text-sm font-bold text-emerald-800">{promoCode.toUpperCase()}</div>
                                                <div className="text-xs text-emerald-600">You save ₹{promoDiscount}</div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={removePromo}
                                            className="text-xs text-red-500 font-semibold hover:text-red-700 transition-colors px-2 py-1"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2.5">
                                        <input
                                            type="text"
                                            value={promoCode}
                                            onChange={(e) => {
                                                setPromoCode(e.target.value.toUpperCase());
                                                setPromoError('');
                                            }}
                                            placeholder="ENTER PROMO CODE"
                                            className="flex-1 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] focus:bg-white transition-all text-sm uppercase tracking-wide font-medium placeholder:text-gray-300 placeholder:font-normal"
                                        />
                                        <button
                                            onClick={applyPromo}
                                            disabled={isVerifyingPromo || !promoCode.trim()}
                                            className="bg-[#4b2192] text-white px-5 py-3 rounded-xl font-semibold hover:bg-[#3d1a7a] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95 text-sm shrink-0"
                                        >
                                            {isVerifyingPromo ? <Loader2 size={16} className="animate-spin" /> : 'Apply'}
                                        </button>
                                    </div>
                                )}
                                {promoError && (
                                    <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                                        <AlertCircle size={12} />
                                        {promoError}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* ─ Wallet ─ */}
                        {walletBalance > 0 && (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <label className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 cursor-pointer hover:bg-gray-50/50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-amber-50 rounded-xl">
                                            <Wallet size={18} className="text-amber-600" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-gray-900">Use Wallet Balance</div>
                                            <div className="text-xs text-gray-500">₹{walletBalance.toLocaleString('en-IN')} available</div>
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            checked={useWallet}
                                            onChange={(e) => setUseWallet(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-gray-200 rounded-full peer-checked:bg-[#4b2192] transition-colors" />
                                        <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-5 transition-transform" />
                                    </div>
                                </label>
                            </div>
                        )}
                    </div>

                    {/* ── Right Column — Price Summary (sticky) ── */}
                    <div className="md:col-span-1">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden sticky top-24">
                            {/* Summary header */}
                            <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-50 bg-gray-50/50">
                                <h3 className="text-base sm:text-lg font-bold text-gray-900">Price Summary</h3>
                            </div>

                            <div className="px-5 py-4 sm:px-6 sm:py-5">
                                {/* Selected patient preview */}
                                {selectedPatient && (
                                    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-purple-50/60 border border-purple-100/60 mb-4">
                                        <div className="w-8 h-8 rounded-full bg-[#4b2192] text-white flex items-center justify-center text-xs font-bold shrink-0">
                                            {getInitials(selectedPatient.name)}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-gray-900 truncate">{selectedPatient.name}</div>
                                            <div className="text-[11px] text-gray-500">{getRelationLabel(selectedPatient.relation)}</div>
                                        </div>
                                    </div>
                                )}

                                {/* Price breakdown */}
                                <div className="space-y-3 mb-5">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Base Price</span>
                                        <span className="text-gray-900 font-medium">₹{basePrice.toLocaleString('en-IN')}</span>
                                    </div>

                                    {discountAmount > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-emerald-600 flex items-center gap-1">
                                                <Sparkles size={12} />
                                                Promo Discount
                                            </span>
                                            <span className="text-emerald-600 font-medium">-₹{discountAmount.toLocaleString('en-IN')}</span>
                                        </div>
                                    )}

                                    {walletDeduction > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-amber-600 flex items-center gap-1">
                                                <Wallet size={12} />
                                                Wallet
                                            </span>
                                            <span className="text-amber-600 font-medium">-₹{walletDeduction.toLocaleString('en-IN')}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Total */}
                                <div className="pt-4 border-t border-gray-100 mb-5">
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-sm font-bold text-gray-900">Total</span>
                                        <div className="text-right">
                                            {discountAmount > 0 && (
                                                <div className="text-xs text-gray-400 line-through mb-0.5">₹{basePrice.toLocaleString('en-IN')}</div>
                                            )}
                                            <span className="text-2xl sm:text-3xl font-extrabold text-[#4b2192]">₹{finalAmount.toLocaleString('en-IN')}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* CTA */}
                                <button
                                    onClick={handleCheckout}
                                    disabled={isCheckingOut || !isFormValid}
                                    className={`w-full py-3.5 sm:py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] text-sm sm:text-base ${
                                        isFormValid
                                            ? 'bg-[#4b2192] text-white hover:bg-[#3d1a7a] shadow-lg shadow-purple-900/15'
                                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    }`}
                                >
                                    {isCheckingOut ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            {finalAmount === 0 ? 'Register for Free' : `Pay & Register ₹${finalAmount.toLocaleString('en-IN')}`}
                                            <ChevronRight size={18} />
                                        </>
                                    )}
                                </button>

                                {!isFormValid && (
                                    <div className="flex items-center gap-1.5 justify-center mt-3 text-xs text-gray-400">
                                        <AlertCircle size={12} />
                                        {!selectedPatientId ? 'Select a patient to continue' : 'Enter date of birth to continue'}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ Mobile Sticky CTA ═══ */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 md:hidden z-50 shadow-2xl shadow-black/10">
                <div className="flex items-center justify-between gap-4 max-w-4xl mx-auto">
                    <div>
                        <div className="text-xs text-gray-400 font-medium">Total</div>
                        <div className="text-xl font-extrabold text-[#4b2192]">₹{finalAmount.toLocaleString('en-IN')}</div>
                    </div>
                    <button
                        onClick={handleCheckout}
                        disabled={isCheckingOut || !isFormValid}
                        className={`flex-1 max-w-[220px] py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.97] text-sm ${
                            isFormValid
                                ? 'bg-[#4b2192] text-white shadow-lg shadow-purple-900/15'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                        {isCheckingOut ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <>
                                {finalAmount === 0 ? 'Register Free' : 'Pay & Register'}
                                <ChevronRight size={16} />
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Skeleton ────────────────────────────────────────
function CampDetailSkeleton() {
    return (
        <div className="w-full min-h-screen bg-gray-50">
            {/* Header Skeleton */}
            <div className="bg-gradient-to-br from-[#3a1278] via-[#4b2192] to-[#7c3aed]">
                <div className="container mx-auto px-4 pt-6 pb-8 sm:pt-8 sm:pb-10 max-w-4xl">
                    <div className="h-4 w-12 bg-white/10 rounded mb-5 animate-pulse" />
                    <div className="h-5 w-20 bg-white/10 rounded-full mb-4 animate-pulse" />
                    <div className="h-9 w-72 bg-white/15 rounded-lg mb-2 animate-pulse" />
                    <div className="h-5 w-96 bg-white/10 rounded-lg mb-5 animate-pulse" />
                    <div className="flex gap-2">
                        <div className="h-8 w-32 bg-white/10 rounded-lg animate-pulse" />
                        <div className="h-8 w-40 bg-white/10 rounded-lg animate-pulse" />
                        <div className="h-8 w-28 bg-white/10 rounded-lg animate-pulse" />
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-3 sm:px-4 py-5 sm:py-8 max-w-4xl">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                    <div className="md:col-span-2 space-y-4 sm:space-y-5">
                        {/* Tests */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-gray-50">
                                <div className="h-6 w-48 bg-gray-100 rounded animate-pulse" />
                            </div>
                            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="h-14 bg-gray-50 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        </div>
                        {/* Patients */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-gray-50">
                                <div className="h-6 w-36 bg-gray-100 rounded animate-pulse" />
                            </div>
                            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {[1, 2].map(i => (
                                    <div key={i} className="h-16 bg-gray-50 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="md:col-span-1">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-gray-50 bg-gray-50/50">
                                <div className="h-6 w-32 bg-gray-100 rounded animate-pulse" />
                            </div>
                            <div className="p-5 space-y-4">
                                <div className="flex justify-between">
                                    <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
                                    <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
                                </div>
                                <div className="pt-4 border-t border-gray-100 flex justify-between">
                                    <div className="h-5 w-12 bg-gray-100 rounded animate-pulse" />
                                    <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
                                </div>
                                <div className="h-12 w-full bg-gray-100 rounded-xl animate-pulse" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
