'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    Loader2, MapPin, Calendar, TestTubes, Shield, Tag,
    Wallet, ChevronRight, AlertCircle, CheckCircle2, User
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
}

interface CheckoutResponse {
    bookingId: string;
    razorpayOrderId: string;
    amount: number;
    currency: string;
    keyId: string;
    status?: string;
}

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
                const [campRes, patientsRes] = await Promise.all([
                    api.get(`/camps/${campId}`),
                    api.get('/profile/patients'),
                ]);

                const campData = campRes.data.camp || campRes.data;
                setCamp(campData);
                setPatients(patientsRes.data || []);

                // Default select first patient
                if (patientsRes.data?.length > 0) {
                    setSelectedPatientId(patientsRes.data[0].id);
                    if (patientsRes.data[0].dob) {
                        setDob(patientsRes.data[0].dob.split('T')[0]);
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

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    };

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

    return (
        <div className="w-full min-h-screen bg-gray-50 pb-32 md:pb-20">
            {/* Camp Header */}
            <div className="bg-gradient-to-br from-[#4b2192] via-[#5b2db0] to-[#7c3aed] text-white">
                <div className="container mx-auto px-4 py-8 sm:py-12 max-w-4xl">
                    <h1 className="text-2xl sm:text-3xl font-bold mb-2">{camp.name}</h1>
                    {camp.description && (
                        <p className="text-white/70 text-sm sm:text-base mb-4">{camp.description}</p>
                    )}
                    <div className="flex flex-wrap gap-4 text-sm text-white/80">
                        <div className="flex items-center gap-1.5">
                            <MapPin size={16} />
                            <span>{camp.location}, {camp.city}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Calendar size={16} />
                            <span>{formatDate(camp.startDate)} — {formatDate(camp.endDate)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <TestTubes size={16} />
                            <span>{camp.items.length} tests included</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 max-w-4xl">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-8">
                    {/* Left Column */}
                    <div className="md:col-span-2 space-y-5">
                        {/* Included Tests */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
                            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
                                <Shield size={20} className="text-[#4b2192]" />
                                Included Tests & Packages
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {camp.items.map(item => (
                                    <div
                                        key={item.id}
                                        className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100"
                                    >
                                        <div className="p-2 bg-purple-50 rounded-lg shrink-0">
                                            <TestTubes size={16} className="text-[#4b2192]" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">{item.catalogItem.name}</div>
                                            <div className="text-xs text-gray-400">{item.catalogItem.type}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Patient Selection */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
                            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
                                <User size={20} className="text-[#4b2192]" />
                                Patient Details
                            </h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Patient</label>
                                    <select
                                        value={selectedPatientId}
                                        onChange={(e) => handlePatientChange(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    >
                                        <option value="">Choose a patient</option>
                                        {patients.map(p => (
                                            <option key={p.id} value={p.id}>
                                                {p.name} {p.relation !== 'self' ? `(${p.relation})` : '(Self)'}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Date of Birth</label>
                                    <input
                                        type="date"
                                        value={dob}
                                        onChange={(e) => setDob(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Promo Code */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
                            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
                                <Tag size={20} className="text-[#4b2192]" />
                                Promo Code
                            </h2>

                            {promoApplied ? (
                                <div className="flex items-center justify-between p-3 rounded-xl bg-green-50 border border-green-200">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 size={18} className="text-green-600" />
                                        <div>
                                            <div className="text-sm font-bold text-green-800">{promoCode.toUpperCase()}</div>
                                            <div className="text-xs text-green-600">You save ₹{promoDiscount}</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={removePromo}
                                        className="text-xs text-red-500 font-medium hover:text-red-700 transition-colors"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ) : (
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={promoCode}
                                        onChange={(e) => {
                                            setPromoCode(e.target.value.toUpperCase());
                                            setPromoError('');
                                        }}
                                        placeholder="Enter promo code"
                                        className="flex-1 px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm uppercase"
                                    />
                                    <button
                                        onClick={applyPromo}
                                        disabled={isVerifyingPromo || !promoCode.trim()}
                                        className="bg-[#4b2192] text-white px-5 py-2.5 rounded-xl font-medium hover:bg-[#3d1a7a] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95 text-sm shrink-0"
                                    >
                                        {isVerifyingPromo ? <Loader2 size={16} className="animate-spin" /> : 'Apply'}
                                    </button>
                                </div>
                            )}
                            {promoError && (
                                <p className="text-xs text-red-500 mt-2">{promoError}</p>
                            )}
                        </div>

                        {/* Wallet */}
                        {walletBalance > 0 && (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
                                <label className="flex items-center justify-between cursor-pointer">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-amber-50 rounded-lg">
                                            <Wallet size={20} className="text-amber-600" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-gray-900">Use Wallet Balance</div>
                                            <div className="text-xs text-gray-500">₹{walletBalance} available</div>
                                        </div>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={useWallet}
                                        onChange={(e) => setUseWallet(e.target.checked)}
                                        className="w-5 h-5 rounded border-gray-300 text-[#4b2192] focus:ring-[#4b2192]/20"
                                    />
                                </label>
                            </div>
                        )}
                    </div>

                    {/* Right Column - Price Summary */}
                    <div className="md:col-span-1">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6 sticky top-24">
                            <h3 className="text-lg font-bold text-gray-900 mb-5">Price Summary</h3>

                            <div className="space-y-3 mb-5">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Base Price</span>
                                    <span className="text-gray-900 font-medium">₹{basePrice}</span>
                                </div>

                                {discountAmount > 0 && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-green-600">Promo Discount</span>
                                        <span className="text-green-600 font-medium">-₹{discountAmount}</span>
                                    </div>
                                )}

                                {walletDeduction > 0 && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-amber-600">Wallet</span>
                                        <span className="text-amber-600 font-medium">-₹{walletDeduction}</span>
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 border-t border-gray-100 mb-6">
                                <div className="flex justify-between items-center">
                                    <span className="text-base font-bold text-gray-900">Total</span>
                                    <span className="text-2xl font-bold text-[#4b2192]">₹{finalAmount}</span>
                                </div>
                            </div>

                            <button
                                onClick={handleCheckout}
                                disabled={isCheckingOut || !selectedPatientId || !dob}
                                className="w-full bg-[#4b2192] text-white py-3.5 rounded-xl font-medium hover:bg-[#3d1a7a] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95 shadow-lg shadow-purple-900/10"
                            >
                                {isCheckingOut ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        Pay & Register ₹{finalAmount}
                                        <ChevronRight size={18} />
                                    </>
                                )}
                            </button>

                            {(!selectedPatientId || !dob) && (
                                <p className="text-xs text-gray-400 text-center mt-3">
                                    Please select a patient and enter DOB to proceed
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CampDetailSkeleton() {
    return (
        <div className="w-full min-h-screen bg-gray-50">
            {/* Header Skeleton */}
            <div className="bg-gradient-to-br from-[#4b2192] via-[#5b2db0] to-[#7c3aed]">
                <div className="container mx-auto px-4 py-8 sm:py-12 max-w-4xl">
                    <div className="h-8 w-64 bg-white/20 rounded-lg animate-pulse mb-3" />
                    <div className="h-5 w-96 bg-white/10 rounded-lg animate-pulse mb-4" />
                    <div className="flex gap-4">
                        <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
                        <div className="h-4 w-40 bg-white/10 rounded animate-pulse" />
                        <div className="h-4 w-28 bg-white/10 rounded animate-pulse" />
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 max-w-4xl">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-8">
                    <div className="md:col-span-2 space-y-5">
                        {/* Tests Skeleton */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
                            <div className="h-6 w-48 bg-gray-200 rounded animate-pulse mb-4" />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        </div>

                        {/* Patient Skeleton */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
                            <div className="h-6 w-36 bg-gray-200 rounded animate-pulse mb-4" />
                            <div className="space-y-4">
                                <div className="h-10 w-full bg-gray-100 rounded-xl animate-pulse" />
                                <div className="h-10 w-full bg-gray-100 rounded-xl animate-pulse" />
                            </div>
                        </div>

                        {/* Promo Skeleton */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
                            <div className="h-6 w-28 bg-gray-200 rounded animate-pulse mb-4" />
                            <div className="h-10 w-full bg-gray-100 rounded-xl animate-pulse" />
                        </div>
                    </div>

                    {/* Summary Skeleton */}
                    <div className="md:col-span-1">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6 sticky top-24">
                            <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-5" />
                            <div className="space-y-3 mb-5">
                                {[1, 2].map(i => (
                                    <div key={i} className="flex justify-between">
                                        <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                                        <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
                                    </div>
                                ))}
                            </div>
                            <div className="pt-4 border-t border-gray-100 mb-6">
                                <div className="flex justify-between">
                                    <div className="h-5 w-16 bg-gray-200 rounded animate-pulse" />
                                    <div className="h-7 w-20 bg-gray-200 rounded animate-pulse" />
                                </div>
                            </div>
                            <div className="h-12 w-full bg-gray-200 rounded-xl animate-pulse" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
