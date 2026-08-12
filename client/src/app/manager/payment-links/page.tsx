'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Plus, Copy, ChevronRight, ChevronLeft, Search,
    CheckCircle, X, User, MapPin, FlaskConical, Calendar, Trash2,
    CreditCard, Smartphone, Banknote, ExternalLink, Loader2,
    AlertCircle, FileText, MessageCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import LocationPicker, { LocationResult } from '@/components/LocationPicker';
import { useForm, useFormContext, useFieldArray, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserResult {
    id: string;
    name: string | null;
    mobile: string;
}

interface CreateUserForm {
    mobile: string;
    name: string;
    age: string;
    gender: 'Male' | 'Female' | 'Other';
    email: string;
    otp: string;
}

interface Patient {
    id: string;
    name: string;
    relation: string;
    age: number;
    gender: string;
}

interface Address {
    id: string;
    line1: string;
    city: string;
    pincode: string;
    lat?: string;
    long?: string;
}

interface CatalogItem {
    id: string;
    partnerCode: string;
    name: string;
    price: number;
    mrp?: number;
    type: string;
}

interface Slot {
    stm_id: string;
    slot_time: string;
    end_time: string;
}

interface CartItem {
    testCode: string;
    testName: string;
    price: number;
    patientId: string; // 'self' | actual patient id
    customPrice?: number; // Manager-specified custom price
    catalogPrice?: number; // Original catalog price for reference
    floorPrice?: number; // Minimum allowed price (70% of catalog)
}

interface ManagerOrder {
    id: string;
    bookingId: string;
    totalAmount: number;
    status: string;
    razorpayLinkUrl?: string;
    customer: { name: string | null; mobile: string };
    createdAt: string;
    canSendInvoice?: boolean;
    invoiceSentAt?: string | null;
    canSendReport?: boolean;
    reportSentAt?: string | null;
}

// ─── Wizard schema ────────────────────────────────────────────────────────────

const managerOrderSchema = z.object({
    user: z.object({
        id: z.string(),
        name: z.string().nullable(),
        mobile: z.string(),
    }).nullable(),
    selectedPatientIds: z.array(z.string()).min(1, 'Select at least one patient'),
    address: z.object({
        id: z.string(),
        line1: z.string(),
        city: z.string(),
        pincode: z.string(),
        lat: z.string().optional(),
        long: z.string().optional(),
    }).nullable(),
    cart: z.array(z.object({
        testCode: z.string(),
        testName: z.string(),
        price: z.number(),
        patientId: z.string(),
        customPrice: z.number().optional(),
        catalogPrice: z.number().optional(),
        floorPrice: z.number().optional(),
    })).min(1, 'Add at least one test'),
    slotDate: z.string().min(1, 'Select a date'),
    slotTime: z.string().min(1, 'Select a time slot'),
    slotLabel: z.string().optional(),
});

type ManagerOrderFormValues = z.infer<typeof managerOrderSchema>;

// ─── Step indicators ─────────────────────────────────────────────────────────

const STEPS = [
    { label: 'Customer', icon: User },
    { label: 'Patients & Address', icon: MapPin },
    { label: 'Tests', icon: FlaskConical },
    { label: 'Slot', icon: Calendar },
    { label: 'Confirm', icon: CreditCard },
];

const PATIENT_RELATIONS = [
    'Spouse',
    'Child',
    'Parent',
    'Grand parent',
    'Sibling',
    'Friend',
    'Native',
    'Neighbour',
    'Colleague',
    'Others',
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StepIndicator({ current, onStepClick }: { current: number; onStepClick?: (step: number) => void }) {
    return (
        <nav className="flex items-center justify-center gap-0 mb-8 overflow-x-auto">
            {STEPS.map((step, i) => {
                const Icon = step.icon;
                const done = i < current;
                const active = i === current;
                const clickable = done && onStepClick;
                return (
                    <div key={i} className="flex items-center">
                        <button
                            type="button"
                            onClick={() => clickable && onStepClick(i)}
                            disabled={!clickable}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all
                                ${active ? 'bg-[#4b2192] text-white shadow-md' : done ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 cursor-pointer' : 'bg-gray-100 text-gray-400'}
                                ${!clickable ? 'cursor-default' : ''}`}
                        >
                            {done ? <CheckCircle className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                            <span className="hidden sm:inline">{step.label}</span>
                        </button>
                        {i < STEPS.length - 1 && (
                            <div className={`h-px w-6 sm:w-8 ${done ? 'bg-purple-400' : 'bg-gray-200'}`} />
                        )}
                    </div>
                );
            })}
        </nav>
    );
}

// ─── Step 1: Customer ──────────────────────────────────────────────────────────

function StepCustomer({ onNext }: { onNext: () => void }) {
    const { setValue } = useFormContext<ManagerOrderFormValues>();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<UserResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [mode, setMode] = useState<'search' | 'create' | 'otp'>('search');
    const [submitting, setSubmitting] = useState(false);
    const [resendTimer, setResendTimer] = useState(0);
    const [form, setForm] = useState<CreateUserForm>({
        mobile: '',
        name: '',
        age: '',
        gender: 'Male',
        email: '',
        otp: '',
    });

    // Debounced search — fires automatically when user types 3+ digits
    useEffect(() => {
        if (query.length < 3) {
            setResults([]);
            setSearched(false);
            setShowDropdown(false);
            return;
        }

        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await api.get('/manager/users/search', { params: { mobile: query } });
                setResults(res.data);
                setSearched(true);
                setShowDropdown(true);
            } catch { toast.error('Search failed'); }
            finally { setLoading(false); }
        }, 350);

        return () => clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        if (resendTimer <= 0) return;
        const timer = window.setInterval(() => {
            setResendTimer(prev => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [resendTimer]);

    const isValidMobile = /^\d{10}$/.test(query);

    const handleSelect = (user: UserResult) => {
        setShowDropdown(false);
        setValue('user', user);
        onNext();
    };

    const openCreateFlow = () => {
        setShowDropdown(false);
        setMode('create');
        setForm({
            mobile: query,
            name: '',
            age: '',
            gender: 'Male',
            email: '',
            otp: '',
        });
    };

    const sendOtp = async () => {
        if (!/^\d{10}$/.test(form.mobile)) {
            toast.error('Enter a valid 10-digit mobile number');
            return;
        }
        if (!form.name.trim()) {
            toast.error('Name is required');
            return;
        }
        if (!form.age || Number(form.age) <= 0) {
            toast.error('Age is required');
            return;
        }

        setSubmitting(true);
        try {
            await api.post('/manager/users/create/send-otp', {
                mobile: form.mobile,
                name: form.name.trim(),
                age: Number(form.age),
                gender: form.gender,
                email: form.email.trim() || undefined,
            });
            setMode('otp');
            setResendTimer(60);
            toast.success('OTP sent to customer');
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to send OTP');
        } finally {
            setSubmitting(false);
        }
    };

    const verifyOtp = async () => {
        if (!form.otp.trim()) {
            toast.error('Enter the OTP from the customer');
            return;
        }

        setSubmitting(true);
        try {
            const res = await api.post('/manager/users/create/verify', {
                mobile: form.mobile,
                name: form.name.trim(),
                age: Number(form.age),
                gender: form.gender,
                email: form.email.trim() || undefined,
                code: form.otp.trim(),
            });
            toast.success('User created successfully');
            setValue('user', res.data.user);
            onNext();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to verify OTP');
        } finally {
            setSubmitting(false);
        }
    };

    const resendOtp = async () => {
        if (resendTimer > 0) return;
        setSubmitting(true);
        try {
            await api.post('/manager/users/create/send-otp', {
                mobile: form.mobile,
                name: form.name.trim(),
                age: Number(form.age),
                gender: form.gender,
                email: form.email.trim() || undefined,
            });
            setResendTimer(60);
            toast.success('OTP resent');
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to resend OTP');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-4">
            {mode === 'search' && (
                <>
                    <h2 className="text-lg font-semibold text-gray-800">Search Customer</h2>
                    <div className="relative">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                value={query}
                                onChange={e => { setQuery(e.target.value.replace(/\D/g, '').slice(0, 10)); }}
                                onFocus={() => { if (results.length > 0 || (searched && results.length === 0)) setShowDropdown(true); }}
                                placeholder="Enter mobile number…"
                                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 outline-none"
                                autoComplete="off"
                            />
                            {loading && (
                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-purple-500" />
                            )}
                        </div>

                        {/* Dropdown results */}
                        {showDropdown && searched && (
                            <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                                {results.length > 0 ? (
                                    results.map(u => (
                                        <button key={u.id} onClick={() => handleSelect(u)}
                                            className="w-full text-left px-4 py-3 hover:bg-purple-50 transition-colors flex items-center justify-between border-b border-gray-100 last:border-b-0">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-xs">
                                                    {(u.name || 'U')[0].toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-gray-900 text-sm">{u.name || 'Unnamed'}</p>
                                                    <p className="text-xs text-gray-500">{u.mobile}</p>
                                                </div>
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                        No customers found for "{query}"
                                    </div>
                                )}

                                {/* Create new user option */}
                                {isValidMobile && results.length === 0 && (
                                    <button
                                        onClick={openCreateFlow}
                                        className="w-full text-left px-4 py-3 bg-purple-50 hover:bg-purple-100 transition-colors flex items-center gap-3 border-t border-purple-100"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-purple-200 flex items-center justify-center text-purple-800">
                                            <Plus className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-purple-900">Create new user</p>
                                            <p className="text-xs text-purple-700">Register {query} with OTP verification</p>
                                        </div>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {query.length > 0 && query.length < 3 && (
                        <p className="text-xs text-gray-400">Type at least 3 digits to search</p>
                    )}
                </>
            )}

            {mode === 'create' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-800">Create New User</h2>
                            <p className="text-sm text-gray-500 mt-1">Capture the customer details before sending OTP.</p>
                        </div>
                        <button
                            onClick={() => setMode('search')}
                            className="btn-ghost text-xs"
                        >
                            Back
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                            value={form.mobile}
                            onChange={e => setForm(prev => ({ ...prev, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                            placeholder="Mobile number"
                            className="input-sm"
                        />
                        <input
                            value={form.name}
                            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Full name"
                            className="input-sm"
                        />
                        <input
                            type="number"
                            value={form.age}
                            onChange={e => setForm(prev => ({ ...prev, age: e.target.value }))}
                            placeholder="Age"
                            className="input-sm"
                        />
                        <select
                            value={form.gender}
                            onChange={e => setForm(prev => ({ ...prev, gender: e.target.value as CreateUserForm['gender'] }))}
                            className="input-sm"
                        >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                        </select>
                        <input
                            value={form.email}
                            onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                            placeholder="Email (optional)"
                            className="input-sm sm:col-span-2"
                        />
                    </div>

                    <button
                        onClick={sendOtp}
                        disabled={submitting}
                        className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                        Send OTP
                    </button>
                </div>
            )}

            {mode === 'otp' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-800">Verify Customer OTP</h2>
                            <p className="text-sm text-gray-500 mt-1">Ask the customer for the OTP received on {form.mobile}.</p>
                        </div>
                        <button
                            onClick={() => setMode('create')}
                            className="btn-ghost text-xs"
                        >
                            Edit details
                        </button>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                        <p className="font-medium text-gray-900">{form.name}</p>
                        <p className="text-gray-500 mt-1">{form.mobile} · {form.age}y · {form.gender}</p>
                        {form.email && <p className="text-gray-500 mt-1">{form.email}</p>}
                    </div>

                    <input
                        value={form.otp}
                        onChange={e => setForm(prev => ({ ...prev, otp: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                        placeholder="Enter 6-digit OTP"
                        className="input-sm"
                    />

                    <div className="flex items-center justify-between gap-3">
                        <button
                            onClick={resendOtp}
                            disabled={submitting || resendTimer > 0}
                            className="btn-ghost text-xs disabled:opacity-50"
                        >
                            {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                        </button>
                        <button
                            onClick={verifyOtp}
                            disabled={submitting}
                            className="btn-primary flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Verify & Create User
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Step 2: Patients & Address ────────────────────────────────────────────────

function StepPatientsAddress({
    user, onNext, onBack
}: {
    user: UserResult;
    onNext: () => void;
    onBack: () => void;
}) {
    const { watch, setValue, trigger, formState: { errors } } = useFormContext<ManagerOrderFormValues>();
    const selectedPatientIds = watch('selectedPatientIds');
    const selectedAddress = watch('address');
    const [patients, setPatients] = useState<Patient[]>([]);
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [showAddPatient, setShowAddPatient] = useState(false);
    const [showAddAddress, setShowAddAddress] = useState(false);
    const [addressStep, setAddressStep] = useState<'map' | 'details'>('map');
    const [pickedLocation, setPickedLocation] = useState<LocationResult | null>(null);
    const [addressLine1, setAddressLine1] = useState('');
    const [saving, setSaving] = useState(false);

    const [pForm, setPForm] = useState({ name: '', relation: '', age: '', gender: 'Male' });
    const canSavePatient = Boolean(pForm.name.trim() && pForm.relation && pForm.age);

    const refresh = useCallback(async () => {
        const [pi, ai] = await Promise.all([
            api.get(`/manager/users/${user.id}/patients`),
            api.get(`/manager/users/${user.id}/addresses`),
        ]);
        setPatients(pi.data);
        setAddresses(ai.data);
    }, [user.id]);

    useEffect(() => { refresh(); }, [refresh]);

    const togglePatient = (id: string) => {
        setValue(
            'selectedPatientIds',
            selectedPatientIds.includes(id)
                ? selectedPatientIds.filter(p => p !== id)
                : [...selectedPatientIds, id]
        );
    };

    const addPatient = async () => {
        setSaving(true);
        try {
            await api.post(`/manager/users/${user.id}/patients`, {
                name: pForm.name, relation: pForm.relation,
                age: parseInt(pForm.age), gender: pForm.gender,
            });
            toast.success('Patient added');
            setShowAddPatient(false);
            setPForm({ name: '', relation: '', age: '', gender: 'Male' });
            await refresh();
        } catch (e: any) { toast.error(e?.response?.data?.error || 'Failed to add patient'); }
        finally { setSaving(false); }
    };

    const addAddress = async () => {
        if (!pickedLocation) return;
        setSaving(true);
        try {
            await api.post(`/manager/users/${user.id}/addresses`, {
                line1: addressLine1.trim() || pickedLocation.formattedAddress,
                city: pickedLocation.city,
                pincode: pickedLocation.pincode,
                lat: pickedLocation.lat,
                long: pickedLocation.lng,
            });
            toast.success('Address added');
            setShowAddAddress(false);
            setAddressStep('map');
            setPickedLocation(null);
            setAddressLine1('');
            await refresh();
        } catch (e: any) { toast.error(e?.response?.data?.error || 'Failed to add address'); }
        finally { setSaving(false); }
    };

    const canProceed = selectedPatientIds.length > 0 && selectedAddress !== null;

    const handleNext = async () => {
        const valid = await trigger(['selectedPatientIds', 'address']);
        if (valid) onNext();
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm">
                    {(user.name || 'U')[0].toUpperCase()}
                </div>
                <div>
                    <p className="font-semibold text-gray-900">{user.name || 'Unnamed'}</p>
                    <p className="text-xs text-gray-500">{user.mobile}</p>
                </div>
            </div>

            {/* Patients — Multi-select */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Select Patients</h3>
                    <button onClick={() => setShowAddPatient(v => !v)}
                        className="text-xs text-purple-700 font-medium flex items-center gap-1 hover:underline">
                        <Plus className="w-3 h-3" /> Add Patient
                    </button>
                </div>
                <p className="text-xs text-gray-400 mb-2">Select one or more patients who need tests. You'll assign tests to each patient in the next step.</p>
                {showAddPatient && (
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-3 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <input value={pForm.name} onChange={e => setPForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Full name" className="input-sm" />
                            <select
                                value={pForm.relation}
                                onChange={e => setPForm(f => ({ ...f, relation: e.target.value }))}
                                className="input-sm"
                            >
                                <option value="">Select relation</option>
                                {PATIENT_RELATIONS.map(relation => (
                                    <option key={relation} value={relation}>{relation}</option>
                                ))}
                            </select>
                            <input type="number" value={pForm.age} onChange={e => setPForm(f => ({ ...f, age: e.target.value }))}
                                placeholder="Age" className="input-sm" />
                            <select value={pForm.gender} onChange={e => setPForm(f => ({ ...f, gender: e.target.value }))} className="input-sm">
                                <option>Male</option><option>Female</option><option>Other</option>
                            </select>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setShowAddPatient(false)} className="btn-ghost text-xs">Cancel</button>
                            <button onClick={addPatient} disabled={saving || !canSavePatient} className="btn-primary text-xs">
                                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                            </button>
                        </div>
                    </div>
                )}
                <div className="space-y-2">
                    {/* Self option */}
                    <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors
                        ${selectedPatientIds.includes('self') ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}>
                        <input type="checkbox" value="self"
                            checked={selectedPatientIds.includes('self')}
                            onChange={() => togglePatient('self')}
                            className="accent-purple-700 w-4 h-4" />
                        <div>
                            <p className="font-medium text-sm">{user.name || 'Customer'}</p>
                            <p className="text-xs text-gray-500">Self</p>
                        </div>
                    </label>
                    {patients.map(p => (
                        <label key={p.id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors
                            ${selectedPatientIds.includes(p.id) ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}>
                            <input type="checkbox" value={p.id}
                                checked={selectedPatientIds.includes(p.id)}
                                onChange={() => togglePatient(p.id)}
                                className="accent-purple-700 w-4 h-4" />
                            <div>
                                <p className="font-medium text-sm">{p.name}</p>
                                <p className="text-xs text-gray-500">{p.relation} · {p.age}y · {p.gender}</p>
                            </div>
                        </label>
                    ))}
                    {patients.length === 0 && !showAddPatient && (
                        <p className="text-xs text-gray-400 text-center py-2">No family members added yet. Select Self or add a patient above.</p>
                    )}
                </div>
            </div>

            {/* Addresses */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Collection Address</h3>
                    <button onClick={() => setShowAddAddress(v => !v)}
                        className="text-xs text-purple-700 font-medium flex items-center gap-1 hover:underline">
                        <Plus className="w-3 h-3" /> Add Address
                    </button>
                </div>
                {showAddAddress && (
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-3 space-y-3">
                        {addressStep === 'map' ? (
                            <LocationPicker
                                onLocationSelect={(loc) => { setPickedLocation(loc); setAddressStep('details'); }}
                                height="280px"
                                showConfirm={true}
                            />
                        ) : (
                            <div className="space-y-3">
                                <div className="bg-white rounded-lg p-3 border border-purple-200">
                                    <div className="flex items-start gap-2">
                                        <MapPin className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="text-sm text-purple-900">{pickedLocation?.formattedAddress}</p>
                                            <p className="text-xs text-purple-600 mt-0.5">
                                                {pickedLocation?.city}{pickedLocation?.city && pickedLocation?.pincode ? ' — ' : ''}{pickedLocation?.pincode}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <input value={addressLine1} onChange={e => setAddressLine1(e.target.value)}
                                    placeholder="House / Flat / Building details" className="input-sm w-full" autoFocus />
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => setAddressStep('map')} className="btn-ghost text-xs">← Change Location</button>
                                    <button onClick={() => { setShowAddAddress(false); setAddressStep('map'); setPickedLocation(null); setAddressLine1(''); }} className="btn-ghost text-xs">Cancel</button>
                                    <button onClick={addAddress} disabled={saving || !pickedLocation} className="btn-primary text-xs">
                                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <div className="space-y-2">
                    {addresses.map(a => (
                        <label key={a.id} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors
                            ${selectedAddress?.id === a.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}>
                            <input type="radio" name="address" value={a.id}
                                checked={selectedAddress?.id === a.id}
                                onChange={() => setValue('address', a)}
                                className="accent-purple-700 mt-0.5" />
                            <div>
                                <p className="font-medium text-sm">{a.line1}</p>
                                <p className="text-xs text-gray-500">{a.city} — {a.pincode}</p>
                            </div>
                        </label>
                    ))}
                    {addresses.length === 0 && !showAddAddress && (
                        <p className="text-xs text-gray-400 text-center py-2">No addresses found. Add one above.</p>
                    )}
                </div>
            </div>

            <div className="flex gap-3 pt-2">
                <button onClick={onBack} className="btn-ghost flex items-center gap-1">
                    <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button disabled={!canProceed} onClick={handleNext}
                    className="btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-50">
                    Continue <ChevronRight className="w-4 h-4" />
                </button>
                {errors.selectedPatientIds && (
                    <p className="text-xs text-red-500 mt-1">{errors.selectedPatientIds.message}</p>
                )}
            </div>
        </div>
    );
}

// ─── Step 3: Test Selection ────────────────────────────────────────────────────

function StepTests({
    user, onNext, onBack
}: {
    user: UserResult;
    onNext: () => void; onBack: () => void;
}) {
    const { watch, trigger, formState: { errors } } = useFormContext<ManagerOrderFormValues>();
    const selectedPatientIds = watch('selectedPatientIds');
    const { fields: cart, append, remove, update } = useFieldArray<ManagerOrderFormValues, 'cart'>({ name: 'cart' });
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<CatalogItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [patients, setPatients] = useState<Patient[]>([]);

    const search = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/catalog/products', { params: { search: query || undefined } });
            setItems(res.data.products || []);
        } catch { toast.error('Failed to fetch catalog'); }
        finally { setLoading(false); }
    }, [query]);

    useEffect(() => { search(); }, []); // load all on mount

    // Fetch patients for dropdown labels
    useEffect(() => {
        api.get(`/manager/users/${user.id}/patients`)
            .then(res => setPatients(res.data))
            .catch(() => {});
    }, [user.id]);

    // Helper: get display name for a patientId
    const getPatientLabel = useCallback((pid: string) => {
        if (pid === 'self') return user.name || 'Self';
        const p = patients.find(pt => pt.id === pid);
        return p ? `${p.name} (${p.relation})` : pid.slice(0, 8);
    }, [patients, user.name]);

    // Check if a specific testCode+patientId combo exists in cart
    const hasDuplicate = useCallback((testCode: string, patientId: string) => {
        return cart.some(c => c.testCode === testCode && c.patientId === patientId);
    }, [cart]);

    // Add test for ALL selected patients (skip existing combos)
    const addForAllPatients = (item: CatalogItem) => {
        const newRows: CartItem[] = [];
        const catalogPrice = item.price;
        const floorPrice = Math.round(catalogPrice * 0.70 * 100) / 100;
        for (const pid of selectedPatientIds) {
            if (!hasDuplicate(item.partnerCode, pid)) {
                newRows.push({
                    testCode: item.partnerCode, testName: item.name,
                    price: item.price, patientId: pid,
                    catalogPrice, floorPrice,
                });
            }
        }
        if (newRows.length === 0) {
            toast.error(`"${item.name}" is already assigned to all selected patients`);
            return;
        }
        append(newRows);
        toast.success(`Added "${item.name}" for ${newRows.length} patient${newRows.length > 1 ? 's' : ''}`);
    };

    // Remove a specific cart row by index
    const removeRow = (index: number) => {
        remove(index);
    };

    // Change patient for a cart row (with duplicate check)
    const changeRowPatient = (index: number, newPatientId: string) => {
        const row = cart[index];
        if (hasDuplicate(row.testCode, newPatientId)) {
            toast.error(`"${row.testName}" is already assigned to ${getPatientLabel(newPatientId)}`);
            return;
        }
        update(index, { ...row, patientId: newPatientId });
    };

    // Count how many of this test are already in cart
    const countInCart = (code: string) => cart.filter(c => c.testCode === code).length;

    const total = cart.reduce((s, c) => {
        const effectivePrice = (c.customPrice !== undefined && c.customPrice !== null && c.floorPrice && c.customPrice >= c.floorPrice && c.customPrice <= (c.catalogPrice || c.price))
            ? c.customPrice : (c.catalogPrice || c.price);
        return s + effectivePrice;
    }, 0);

    // Check if any cart item has an invalid custom price
    const hasInvalidPrice = cart.some(c =>
        c.customPrice !== undefined && c.customPrice !== null && c.floorPrice && c.customPrice < c.floorPrice
    );

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
                        placeholder="Search tests or packages…"
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 outline-none" />
                </div>
                <button onClick={search} disabled={loading}
                    className="px-4 py-2.5 rounded-lg text-white text-sm font-medium bg-[#4b2192] hover:bg-purple-900 disabled:opacity-60">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-2">
                {items.map(item => {
                    const inCartCount = countInCart(item.partnerCode);
                    return (
                        <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg transition-colors
                            ${inCartCount > 0 ? 'bg-purple-50 border border-purple-200' : 'hover:bg-gray-50'}`}>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">{item.name}</p>
                                <p className="text-xs text-gray-400 uppercase">{item.type}</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="text-right">
                                    <p className="text-sm font-semibold text-purple-700">₹{item.price}</p>
                                    {item.mrp && <p className="text-xs text-gray-400 line-through">₹{item.mrp}</p>}
                                </div>
                                <button
                                    onClick={() => addForAllPatients(item)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                        inCartCount >= selectedPatientIds.length
                                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                            : 'bg-[#4b2192] text-white hover:bg-purple-900'
                                    }`}
                                    disabled={inCartCount >= selectedPatientIds.length}
                                >
                                    {inCartCount > 0 ? `Added (${inCartCount})` : '+ Add'}
                                </button>
                            </div>
                        </div>
                    );
                })}
                {items.length === 0 && !loading && (
                    <p className="text-sm text-gray-400 text-center py-4">No items found.</p>
                )}
            </div>

            {cart.length > 0 && (
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                    <h4 className="text-sm font-semibold text-purple-800 mb-3">Cart ({cart.length} items)</h4>
                    <div className="space-y-2">
                        {cart.map((c, idx) => {
                            const hasCustom = c.customPrice !== undefined && c.customPrice !== null && c.customPrice !== c.catalogPrice;
                            const priceError = c.customPrice !== undefined && c.customPrice !== null && c.floorPrice && c.customPrice < c.floorPrice;
                            return (
                            <div key={`${c.testCode}-${c.patientId}-${idx}`}
                                className={`bg-white border rounded-lg p-2.5 ${priceError ? 'border-red-300' : hasCustom ? 'border-amber-300' : 'border-purple-100'}`}>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">{c.testName}</p>
                                        {hasCustom && !priceError && (
                                            <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                                Custom price
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-gray-400">₹</span>
                                        <input
                                            type="number"
                                            value={c.customPrice !== undefined && c.customPrice !== null ? c.customPrice : c.price}
                                            onChange={e => {
                                                const val = e.target.value === '' ? undefined : Number(e.target.value);
                                                update(idx, {
                                                    ...c,
                                                    customPrice: val,
                                                    price: val !== undefined && val !== null && c.floorPrice && val >= c.floorPrice && val <= (c.catalogPrice || c.price)
                                                        ? val : (c.catalogPrice || c.price),
                                                });
                                            }}
                                            min={c.floorPrice || 0}
                                            max={c.catalogPrice || undefined}
                                            step="1"
                                            className={`w-20 text-sm font-semibold text-right border rounded-lg px-2 py-1 outline-none focus:ring-2 ${
                                                priceError
                                                    ? 'border-red-300 text-red-700 focus:ring-red-300'
                                                    : hasCustom
                                                        ? 'border-amber-300 text-amber-700 focus:ring-amber-300'
                                                        : 'border-gray-200 text-purple-700 focus:ring-purple-300'
                                            }`}
                                        />
                                    </div>
                                    <select
                                        value={c.patientId}
                                        onChange={e => changeRowPatient(idx, e.target.value)}
                                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-purple-300 outline-none max-w-[140px]"
                                    >
                                        {selectedPatientIds.map(pid => (
                                            <option key={pid} value={pid}>{getPatientLabel(pid)}</option>
                                        ))}
                                    </select>
                                    <button onClick={() => removeRow(idx)}
                                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Remove">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                {priceError && (
                                    <p className="text-[11px] text-red-600 mt-1 pl-1">
                                        Min: ₹{c.floorPrice} (70% of ₹{c.catalogPrice})
                                    </p>
                                )}
                                {!priceError && c.floorPrice && hasCustom && (
                                    <p className="text-[11px] text-gray-400 mt-1 pl-1">
                                        Range: ₹{c.floorPrice} – ₹{c.catalogPrice}
                                    </p>
                                )}
                            </div>
                        );})}
                    </div>
                    <div className="border-t border-purple-200 mt-3 pt-2 flex justify-between font-bold text-purple-900">
                        <span>Total</span>
                        <span>₹{total}</span>
                    </div>
                </div>
            )}

            <div className="flex gap-3 pt-2">
                <button onClick={onBack} className="btn-ghost flex items-center gap-1">
                    <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button disabled={cart.length === 0 || hasInvalidPrice} onClick={async () => { const valid = await trigger('cart'); if (valid) onNext(); }}
                    className="btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-50">
                    Continue <ChevronRight className="w-4 h-4" />
                </button>
                {errors.cart && (
                    <p className="text-xs text-red-500 mt-1">{errors.cart.message || errors.cart.root?.message}</p>
                )}
            </div>
        </div>
    );
}

// ─── Step 4: Slot ──────────────────────────────────────────────────────────────

const FREEZE_DURATION_MS = 15 * 60 * 1000;
const AUTO_REFREEZE_AT_MS = 3 * 60 * 1000;
const SLOT_WARNING_SECONDS = 5 * 60;
const SLOT_URGENT_SECONDS = 2 * 60;

function formatSlotTimer(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function StepSlot({
    onNext, onBack
}: {
    onNext: () => void; onBack: () => void;
}) {
    const { watch, setValue, trigger } = useFormContext<ManagerOrderFormValues>();
    const address = watch('address')!;
    const cart = watch('cart');
    const slotDate = watch('slotDate');
    const slotTime = watch('slotTime');
    const [slots, setSlots] = useState<Slot[]>([]);
    const [loading, setLoading] = useState(false);
    const [freezingSlot, setFreezingSlot] = useState(false);
    const [isSlotLocked, setIsSlotLocked] = useState(false);
    const [freezeExpiresAt, setFreezeExpiresAt] = useState<number | null>(null);
    const [secondsRemaining, setSecondsRemaining] = useState(0);
    const autoRefreezeRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, []);

    // Countdown ticker
    useEffect(() => {
        if (!freezeExpiresAt || !isSlotLocked) {
            setSecondsRemaining(0);
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            return;
        }

        const tick = () => {
            const remaining = Math.max(0, Math.floor((freezeExpiresAt - Date.now()) / 1000));
            setSecondsRemaining(remaining);

            if (remaining * 1000 <= AUTO_REFREEZE_AT_MS && remaining > 0 && !autoRefreezeRef.current) {
                autoRefreezeRef.current = true;
                silentRefreeze();
            }
            if (remaining <= 0) {
                if (timerRef.current) clearInterval(timerRef.current);
                setIsSlotLocked(false);
                setFreezeExpiresAt(null);
                setSecondsRemaining(0);
                autoRefreezeRef.current = false;
                toast.error('Slot reservation expired. Please lock the slot again.', { duration: 5000 });
            }
        };

        tick();
        timerRef.current = setInterval(tick, 1000);
        return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
    }, [freezeExpiresAt, isSlotLocked]); // eslint-disable-line react-hooks/exhaustive-deps

    const silentRefreeze = async () => {
        if (!slotTime) return;
        try {
            await api.post('/manager/slots/freeze', { slot_id: slotTime });
            setFreezeExpiresAt(Date.now() + FREEZE_DURATION_MS);
            autoRefreezeRef.current = false;
        } catch { console.warn('[Manager] Auto re-freeze failed'); }
    };

    const resetFreeze = () => {
        setIsSlotLocked(false);
        setFreezeExpiresAt(null);
        setSecondsRemaining(0);
        autoRefreezeRef.current = false;
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };

    const handleFreezeSlot = async () => {
        if (!slotTime) return;
        try {
            setFreezingSlot(true);
            await api.post('/manager/slots/freeze', { slot_id: slotTime });
            toast.success('Slot locked! Complete the order within 15 minutes.');
            setIsSlotLocked(true);
            setFreezeExpiresAt(Date.now() + FREEZE_DURATION_MS);
            autoRefreezeRef.current = false;
        } catch {
            toast.error('Failed to lock slot. Try another one.');
            resetFreeze();
        } finally {
            setFreezingSlot(false);
        }
    };

    const fetchSlots = useCallback(async () => {
        if (!slotDate) return;
        setLoading(true);
        try {
            const res = await api.post('/manager/slots', {
                lat: address.lat || '0', long: address.long || '0',
                zipcode: address.pincode, date: slotDate,
                items: cart.map(c => ({ testCode: c.testCode, patientId: c.patientId }))
            });
            const raw = Array.isArray(res.data) ? res.data : (res.data?.slots || res.data?.data || []);
            setSlots(raw);
        } catch { toast.error('Failed to fetch slots'); setSlots([]); }
        finally { setLoading(false); }
    }, [slotDate, address, cart]);

    useEffect(() => { if (slotDate) fetchSlots(); }, [slotDate, fetchSlots]);

    const today = new Date().toISOString().split('T')[0];

    const timerLevel = isSlotLocked && secondsRemaining > 0
        ? secondsRemaining <= SLOT_URGENT_SECONDS ? 'urgent'
        : secondsRemaining <= SLOT_WARNING_SECONDS ? 'warning'
        : 'normal'
        : 'none';

    return (
        <div className="space-y-4">
            <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Select Date</label>
                <input type="date" value={slotDate} min={today}
                    onChange={e => { setValue('slotDate', e.target.value); setValue('slotTime', ''); setValue('slotLabel', ''); resetFreeze(); }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none" />
            </div>

            {slotDate && (
                <div>
                    <label className="text-sm font-medium text-gray-700 block mb-2">Choose Time Slot</label>
                    {loading ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-purple-500" /></div>
                    ) : slots.length > 0 ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {slots.map(s => {
                                    const label = `${s.slot_time} – ${s.end_time}`;
                                    const selected = slotTime === s.stm_id;
                                    return (
                                        <button key={s.stm_id}
                                            onClick={() => { setValue('slotTime', s.stm_id); setValue('slotLabel', `${s.slot_time} – ${s.end_time}`); resetFreeze(); }}
                                            disabled={isSlotLocked && !selected}
                                            className={`text-sm py-2.5 px-3 rounded-lg border font-medium transition-colors
                                                ${selected ? 'bg-[#4b2192] text-white border-purple-700' :
                                                isSlotLocked ? 'opacity-40 cursor-not-allowed border-gray-300' :
                                                'border-gray-300 hover:border-purple-400 hover:bg-purple-50'}`}>
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Lock Slot Button */}
                            {slotTime && !isSlotLocked && (
                                <button
                                    onClick={handleFreezeSlot}
                                    disabled={freezingSlot}
                                    className="w-full py-2.5 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                                >
                                    {freezingSlot ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Locking Slot...</>
                                    ) : (
                                        <><Calendar className="w-4 h-4" /> 🔒 Lock Slot</>
                                    )}
                                </button>
                            )}

                            {/* Slot Locked confirmation */}
                            {isSlotLocked && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
                                    <CheckCircle className="w-4 h-4" /> Slot Locked ✓
                                </div>
                            )}

                            {/* Countdown Timer */}
                            {isSlotLocked && secondsRemaining > 0 && (
                                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-500
                                    ${timerLevel === 'urgent' ? 'bg-red-50 border-red-200 text-red-700 animate-pulse' :
                                    timerLevel === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                    'bg-blue-50 border-blue-200 text-blue-700'}`}
                                >
                                    <Calendar className={`w-5 h-5 flex-shrink-0 ${
                                        timerLevel === 'urgent' ? 'text-red-500' :
                                        timerLevel === 'warning' ? 'text-amber-500' : 'text-blue-500'
                                    }`} />
                                    <div className="flex-1">
                                        {timerLevel === 'urgent' ? (
                                            <span className="font-bold">⚠️ Hurry! Slot expires in {formatSlotTimer(secondsRemaining)}</span>
                                        ) : timerLevel === 'warning' ? (
                                            <span>Complete the order soon — <b>{formatSlotTimer(secondsRemaining)}</b> remaining</span>
                                        ) : (
                                            <span>Slot reserved for <b>{formatSlotTimer(secondsRemaining)}</b>. Complete the order before it expires.</span>
                                        )}
                                    </div>
                                    <span className={`text-lg font-black font-mono tabular-nums ${
                                        timerLevel === 'urgent' ? 'text-red-600' :
                                        timerLevel === 'warning' ? 'text-amber-600' : 'text-blue-600'
                                    }`}>
                                        {formatSlotTimer(secondsRemaining)}
                                    </span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center py-6">
                            <AlertCircle className="w-8 h-8 text-orange-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">No slots available for this date. Try a different date.</p>
                        </div>
                    )}
                </div>
            )}


            <div className="flex gap-3 pt-2">
                <button onClick={onBack} className="btn-ghost flex items-center gap-1">
                    <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button disabled={!slotDate || !slotTime || !isSlotLocked} onClick={async () => { const valid = await trigger(['slotDate', 'slotTime']); if (valid) onNext(); }}
                    className="btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-50">
                    Continue <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// ─── Cart Summary grouped by patient ──────────────────────────────────────────

function CartSummaryByPatient({ cart, userId, userName }: { cart: CartItem[]; userId: string; userName: string | null }) {
    const [patients, setPatients] = useState<Patient[]>([]);

    useEffect(() => {
        api.get(`/manager/users/${userId}/patients`)
            .then(res => setPatients(res.data))
            .catch(() => {});
    }, [userId]);

    const getLabel = (pid: string) => {
        if (pid === 'self') return userName || 'Self';
        const p = patients.find(pt => pt.id === pid);
        return p ? `${p.name} (${p.relation})` : pid.slice(0, 8);
    };

    // Group cart items by patientId
    const grouped = useMemo(() => {
        const map = new Map<string, CartItem[]>();
        for (const item of cart) {
            const existing = map.get(item.patientId) || [];
            existing.push(item);
            map.set(item.patientId, existing);
        }
        return Array.from(map.entries());
    }, [cart]);

    return (
        <>
            {grouped.map(([pid, items]) => (
                <div key={pid}>
                    <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">
                        {getLabel(pid)}
                    </p>
                    {items.map((c, i) => {
                        const hasCustom = c.customPrice !== undefined && c.customPrice !== null && c.catalogPrice && c.customPrice !== c.catalogPrice;
                        const effectivePrice = hasCustom ? c.customPrice! : c.price;
                        return (
                            <div key={`${c.testCode}-${i}`} className="flex justify-between text-sm pl-2">
                                <span className="text-gray-700 flex items-center gap-1.5">
                                    {c.testName}
                                    {hasCustom && (
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                            Custom
                                        </span>
                                    )}
                                </span>
                                <span className="font-medium flex items-center gap-1.5">
                                    {hasCustom && (
                                        <span className="text-xs text-gray-400 line-through">₹{c.catalogPrice}</span>
                                    )}
                                    ₹{effectivePrice}
                                </span>
                            </div>
                        );
                    })}
                </div>
            ))}
        </>
    );
}

// ─── Step 5: Confirm & Pay ────────────────────────────────────────────────────

function StepConfirm({
    onBack, onSuccess
}: {
    onBack: () => void; onSuccess: () => void;
}) {
    const { watch } = useFormContext<ManagerOrderFormValues>();
    const user = watch('user')!;
    const address = watch('address')!;
    const cart = watch('cart');
    const slotDate = watch('slotDate');
    const slotTime = watch('slotTime');
    const selectedPatientIds = watch('selectedPatientIds');
    const [creating, setCreating] = useState(false);
    const [result, setResult] = useState<{ orderId: string; bookingId: string } | null>(null);
    const [linkUrl, setLinkUrl] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [whatsappSending, setWhatsappSending] = useState(false);
    const [payMode, setPayMode] = useState<'RAZORPAY_LINK' | 'OFFLINE_CASH' | 'OFFLINE_UPI' | null>(null);
    const [remarks, setRemarks] = useState('');

    const hasCustomPricing = cart.some(c => c.customPrice !== undefined && c.customPrice !== null && c.catalogPrice && c.customPrice !== c.catalogPrice);

    const total = cart.reduce((s, c) => {
        const effectivePrice = (c.customPrice !== undefined && c.customPrice !== null && c.floorPrice && c.customPrice >= c.floorPrice && c.customPrice <= (c.catalogPrice || c.price))
            ? c.customPrice : (c.catalogPrice || c.price);
        return s + effectivePrice;
    }, 0);

    const catalogTotal = cart.reduce((s, c) => s + (c.catalogPrice || c.price), 0);
    const totalDiscount = hasCustomPricing ? catalogTotal - total : 0;

    const createOrder = async () => {
        setCreating(true);
        try {
            const res = await api.post('/manager/orders', {
                userId: user.id,
                addressId: address.id,
                slotDate, slotTime,
                slotLabel: watch('slotLabel') || '',
                items: cart.map(c => {
                    const hasCustom = c.customPrice !== undefined && c.customPrice !== null && c.catalogPrice && c.customPrice !== c.catalogPrice;
                    return {
                        testCode: c.testCode,
                        patientId: c.patientId,
                        ...(hasCustom ? { customPrice: c.customPrice } : {}),
                    };
                }),
                ...(hasCustomPricing && remarks.trim() ? { remarks: remarks.trim() } : {}),
            });
            setResult({ orderId: res.data.managerOrder.id, bookingId: res.data.booking.id });
            toast.success('Order created!');
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to create order');
        } finally { setCreating(false); }
    };

    const generateLink = async () => {
        if (!result) return;
        setGenerating(true);
        try {
            const res = await api.post(`/manager/orders/${result.orderId}/payment-link`);
            setLinkUrl(res.data.shortUrl);
            toast.success('Payment link generated!');
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to generate link');
        } finally { setGenerating(false); }
    };

    const confirmPayment = async () => {
        if (!result || !payMode) return;
        setConfirming(true);
        try {
            await api.post(`/manager/orders/${result.orderId}/confirm-payment`, { collectionMode: payMode });
            toast.success('Payment confirmed & booking finalized!');
            onSuccess();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to confirm payment');
        } finally { setConfirming(false); }
    };

    const copyLink = () => {
        if (linkUrl) { navigator.clipboard.writeText(linkUrl); toast.success('Copied!'); }
    };

    const sendWhatsApp = async () => {
        if (!result) return;
        setWhatsappSending(true);
        try {
            const res = await api.post(`/manager/orders/${result.orderId}/send-whatsapp-link`);
            toast.success(res.data.message || 'Payment link sent via WhatsApp!');
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to send WhatsApp message');
        } finally {
            setWhatsappSending(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* Summary */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 divide-y divide-gray-100">
                <div className="px-4 py-3 flex justify-between text-sm">
                    <span className="text-gray-500">Customer</span>
                    <span className="font-medium">{user.name || user.mobile}</span>
                </div>
                <div className="px-4 py-3 flex justify-between text-sm">
                    <span className="text-gray-500">Address</span>
                    <span className="font-medium text-right max-w-[55%]">{address.line1}, {address.city} - {address.pincode}</span>
                </div>
                <div className="px-4 py-3 flex justify-between text-sm">
                    <span className="text-gray-500">Slot</span>
                    <span className="font-medium">{(() => { try { const d = new Date(slotDate + 'T00:00:00'); return isNaN(d.getTime()) ? slotDate : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return slotDate; } })()} · {watch('slotLabel') || slotTime}</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                    <CartSummaryByPatient cart={cart} userId={user.id} userName={user.name} />
                </div>
                {hasCustomPricing && totalDiscount > 0 && (
                    <div className="px-4 py-2 flex justify-between text-sm text-amber-700 bg-amber-50/50">
                        <span className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Custom Pricing</span>
                            Discount
                        </span>
                        <span className="font-medium">-₹{totalDiscount}</span>
                    </div>
                )}
                <div className="px-4 py-3 flex justify-between font-bold text-purple-900">
                    <span>Total</span>
                    <span className="flex items-center gap-2">
                        {hasCustomPricing && totalDiscount > 0 && (
                            <span className="text-sm font-normal text-gray-400 line-through">₹{catalogTotal}</span>
                        )}
                        ₹{total}
                    </span>
                </div>
            </div>

            {/* Remarks for custom pricing */}
            {hasCustomPricing && !result && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                    <label className="text-sm font-medium text-amber-800 block">
                        Reason for custom pricing (optional)
                    </label>
                    <textarea
                        value={remarks}
                        onChange={e => setRemarks(e.target.value)}
                        placeholder="e.g. Negotiated rate for returning customer, corporate tie-up, etc."
                        rows={2}
                        className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-amber-300 outline-none resize-none"
                    />
                </div>
            )}

            {!result ? (
                <div className="flex gap-3">
                    <button onClick={onBack} className="btn-ghost flex items-center gap-1">
                        <ChevronLeft className="w-4 h-4" /> Back
                    </button>
                    <button onClick={createOrder} disabled={creating}
                        className="btn-primary flex-1 flex items-center justify-center gap-2">
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Create Order
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                        <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                        <p className="text-sm font-medium text-green-800">Order created — choose payment method below</p>
                    </div>

                    {/* Payment Link */}
                    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <Smartphone className="w-4 h-4 text-purple-600" />
                            <h4 className="font-semibold text-sm text-gray-800">Send Razorpay Payment Link</h4>
                        </div>
                        {linkUrl ? (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <input value={linkUrl} readOnly className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 font-mono" />
                                    <button onClick={copyLink} className="px-3 py-2 border rounded-lg hover:bg-gray-50"><Copy className="w-4 h-4" /></button>
                                    <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-2 border rounded-lg hover:bg-gray-50">
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                </div>
                                <button
                                    onClick={sendWhatsApp}
                                    disabled={whatsappSending}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                                >
                                    {whatsappSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                                    {whatsappSending ? 'Sending...' : 'Send Payment Link via WhatsApp'}
                                </button>
                            </div>
                        ) : (
                            <button onClick={generateLink} disabled={generating}
                                className="w-full btn-primary flex items-center justify-center gap-2">
                                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                                Generate & Send Payment Link
                            </button>
                        )}
                    </div>

                    {/* Offline */}
                    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <Banknote className="w-4 h-4 text-emerald-600" />
                            <h4 className="font-semibold text-sm text-gray-800">Record Offline Payment</h4>
                        </div>
                        <div className="flex gap-2">
                            {(['OFFLINE_CASH', 'OFFLINE_UPI'] as const).map(m => (
                                <button key={m} onClick={() => setPayMode(m)}
                                    className={`flex-1 text-sm py-2 px-3 rounded-lg border font-medium transition-colors
                                        ${payMode === m ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 hover:border-emerald-400'}`}>
                                    {m === 'OFFLINE_CASH' ? '💵 Cash' : '📱 UPI'}
                                </button>
                            ))}
                        </div>
                        {payMode && payMode !== 'RAZORPAY_LINK' && (
                            <button onClick={confirmPayment} disabled={confirming}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
                                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                Confirm {payMode === 'OFFLINE_CASH' ? 'Cash' : 'UPI'} Payment & Finalize
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Order List ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
    CREATED: 'bg-gray-100 text-gray-700',
    SENT: 'bg-blue-100 text-blue-700',
    PAYMENT_RECEIVED: 'bg-yellow-100 text-yellow-800',
    PAYMENT_CONFIRMED: 'bg-purple-100 text-purple-700',
    CONFIRMED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
    BOOKING_FAILED: 'bg-red-100 text-red-700',
    REFUNDED: 'bg-orange-100 text-orange-700',
};

function OrderList({ refresh }: { refresh: boolean }) {
    const [orders, setOrders] = useState<ManagerOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState<string | null>(null);
    const [invoiceSendingId, setInvoiceSendingId] = useState<string | null>(null);
    const [reportSendingId, setReportSendingId] = useState<string | null>(null);
    const [whatsappSendingId, setWhatsappSendingId] = useState<string | null>(null);
    const [paymentModal, setPaymentModal] = useState<ManagerOrder | null>(null);
    const [payMode, setPayMode] = useState<'OFFLINE_CASH' | 'OFFLINE_UPI' | null>(null);
    const [confirming, setConfirming] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/manager/orders');
            setOrders(res.data);
        } catch { /* silently fail in list */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load, refresh]);

    const generateLink = async (orderId: string) => {
        setGenerating(orderId);
        try {
            const res = await api.post(`/manager/orders/${orderId}/payment-link`);
            toast.success('Payment link sent!');
            if (res.data.shortUrl) {
                navigator.clipboard.writeText(res.data.shortUrl);
                toast('Link copied to clipboard', { icon: '📋' });
            }
            await load();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to generate link');
        } finally { setGenerating(null); }
    };

    const sendInvoice = async (order: ManagerOrder) => {
        setInvoiceSendingId(order.id);
        try {
            const res = await api.post(`/manager/bookings/${order.bookingId}/send-invoice`);
            toast.success(res.data.message || 'Invoice sent successfully');
            await load();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to send invoice');
        } finally {
            setInvoiceSendingId(null);
        }
    };

    const sendReport = async (order: ManagerOrder) => {
        setReportSendingId(order.id);
        try {
            const res = await api.post(`/manager/bookings/${order.bookingId}/send-report`);
            toast.success(res.data.message || 'Report sent successfully');
            await load();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to send report');
        } finally {
            setReportSendingId(null);
        }
    };

    const sendWhatsAppLink = async (order: ManagerOrder) => {
        setWhatsappSendingId(order.id);
        try {
            const res = await api.post(`/manager/orders/${order.id}/send-whatsapp-link`);
            toast.success(res.data.message || 'Payment link sent via WhatsApp');
            await load();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to send WhatsApp message');
        } finally {
            setWhatsappSendingId(null);
        }
    };

    const confirmOfflinePayment = async () => {
        if (!paymentModal || !payMode) return;
        setConfirming(true);
        try {
            await api.post(`/manager/orders/${paymentModal.id}/confirm-payment`, { collectionMode: payMode });
            toast.success('Payment confirmed & booking finalized!');
            setPaymentModal(null);
            setPayMode(null);
            await load();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to confirm payment');
        } finally {
            setConfirming(false);
        }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-purple-500" /></div>;
    if (orders.length === 0) return (
        <div className="text-center py-12 text-gray-400">
            <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No orders yet. Create one above.</p>
        </div>
    );

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 tracking-wide">
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Booking</th>
                        <th className="px-4 py-3">Created</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {orders.map(order => (
                        <tr key={order.id} className="border-b border-gray-100 hover:bg-purple-50/30 transition-colors">
                            <td className="px-4 py-3">
                                <p className="font-medium text-gray-900">{order.customer.name || 'Unnamed'}</p>
                                <p className="text-xs text-gray-400">{order.customer.mobile}</p>
                            </td>
                            <td className="px-4 py-3 font-semibold">₹{order.totalAmount.toLocaleString()}</td>
                            <td className="px-4 py-3">
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-700'}`}>
                                    {order.status.replace(/_/g, ' ')}
                                </span>
                            </td>
                            <td className="px-4 py-3">
                                <span className="text-xs text-gray-500 font-mono">{order.bookingId.slice(0, 8)}…</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                                {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            </td>
                            <td className="px-4 py-3 text-right">
                                <div className="flex flex-col items-end gap-2">
                                    {['CREATED', 'SENT'].includes(order.status) && (
                                        <button onClick={() => generateLink(order.id)} disabled={generating === order.id}
                                            className="text-xs px-3 py-1.5 rounded-lg bg-[#4b2192] text-white hover:bg-purple-900 disabled:opacity-60 flex items-center gap-1">
                                            {generating === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />}
                                            {order.status === 'SENT' ? 'Resend' : 'Send'} Link
                                        </button>
                                    )}
                                    {['CREATED', 'SENT'].includes(order.status) && (
                                        <button
                                            onClick={() => sendWhatsAppLink(order)}
                                            disabled={whatsappSendingId === order.id}
                                            className="text-xs px-3 py-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-60 flex items-center gap-1"
                                        >
                                            {whatsappSendingId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
                                            {whatsappSendingId === order.id ? 'Sending...' : 'Send WhatsApp'}
                                        </button>
                                    )}
                                    {order.canSendInvoice && (
                                        <button
                                            onClick={() => sendInvoice(order)}
                                            disabled={invoiceSendingId === order.id}
                                            className="text-xs px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-60 flex items-center gap-1"
                                        >
                                            {invoiceSendingId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                                            {invoiceSendingId === order.id
                                                ? 'Sending...'
                                                : order.invoiceSentAt
                                                    ? 'Resend Invoice'
                                                    : 'Send Invoice'}
                                        </button>
                                    )}
                                    {order.canSendReport && (
                                        <button
                                            onClick={() => sendReport(order)}
                                            disabled={reportSendingId === order.id}
                                            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-60 flex items-center gap-1"
                                        >
                                            {reportSendingId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                                            {reportSendingId === order.id
                                                ? 'Sending...'
                                                : order.reportSentAt
                                                    ? 'Resend Report'
                                                    : 'Send Report'}
                                        </button>
                                    )}
                                    {['CREATED', 'SENT'].includes(order.status) && (
                                        <button
                                            onClick={() => { setPaymentModal(order); setPayMode(null); }}
                                            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1"
                                        >
                                            <Banknote className="w-3 h-3" />
                                            Record Payment
                                        </button>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Offline Payment Confirmation Modal */}
            {paymentModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-gray-900">Record Offline Payment</h3>
                            <button onClick={() => { setPaymentModal(null); setPayMode(null); }} className="p-1.5 hover:bg-gray-100 rounded-lg">
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Customer</span>
                                    <span className="font-medium">{paymentModal.customer.name || paymentModal.customer.mobile}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Amount</span>
                                    <span className="font-bold text-purple-900">₹{paymentModal.totalAmount.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Status</span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[paymentModal.status] || 'bg-gray-100 text-gray-700'}`}>
                                        {paymentModal.status.replace(/_/g, ' ')}
                                    </span>
                                </div>
                            </div>

                            <div>
                                <p className="text-sm font-medium text-gray-700 mb-2">Select payment method collected:</p>
                                <div className="flex gap-2">
                                    {(['OFFLINE_CASH', 'OFFLINE_UPI'] as const).map(m => (
                                        <button key={m} onClick={() => setPayMode(m)}
                                            className={`flex-1 text-sm py-2.5 px-3 rounded-lg border font-medium transition-colors
                                                ${payMode === m ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50'}`}>
                                            {m === 'OFFLINE_CASH' ? '💵 Cash' : '📱 UPI'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {payMode && (
                                <button onClick={confirmOfflinePayment} disabled={confirming}
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
                                    {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                    Confirm {payMode === 'OFFLINE_CASH' ? 'Cash' : 'UPI'} Payment & Finalize
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentLinksPage() {
    const [showWizard, setShowWizard] = useState(false);
    const [step, setStep] = useState(0);
    const [listRefresh, setListRefresh] = useState(false);

    // Camp-specific state
    const [orderMode, setOrderMode] = useState<'HOME_COLLECTION' | 'CAMP'>('HOME_COLLECTION');
    const [campStep, setCampStep] = useState(0);
    const [selectedCamp, setSelectedCamp] = useState<any>(null);
    const [campPatientId, setCampPatientId] = useState<string>('');
    const [campDob, setCampDob] = useState<string>('');
    const [campPricingTier, setCampPricingTier] = useState<'SINGLE' | 'FAMILY'>('SINGLE');
    const [campResult, setCampResult] = useState<{orderId: string, bookingId: string} | null>(null);
    const [campCreating, setCampCreating] = useState(false);

    // Wizard form state (replaces 6 individual useState hooks)
    const methods = useForm<ManagerOrderFormValues>({
        resolver: zodResolver(managerOrderSchema),
        defaultValues: {
            user: null,
            selectedPatientIds: [],
            address: null,
            cart: [],
            slotDate: '',
            slotTime: '',
            slotLabel: '',
        },
    });

    const selectedUser = methods.watch('user');
    const selectedAddress = methods.watch('address');

    const resetWizard = () => {
        setStep(0);
        methods.reset();
        setShowWizard(false);
        setOrderMode('HOME_COLLECTION');
        setCampStep(0);
        setSelectedCamp(null);
        setCampPatientId('');
        setCampDob('');
        setCampPricingTier('SINGLE');
        setCampResult(null);
    };

    const handleSuccess = () => {
        resetWizard();
        setListRefresh(v => !v);
        toast.success('🎉 Order finalized successfully!');
    };

    function ResultActions({ orderId, bookingId }: { orderId: string, bookingId: string }) {
        const [linkUrl, setLinkUrl] = useState<string | null>(null);
        const [generating, setGenerating] = useState(false);
        const [confirming, setConfirming] = useState(false);
        const [whatsappSending, setWhatsappSending] = useState(false);
        const [payMode, setPayMode] = useState<'RAZORPAY_LINK' | 'OFFLINE_CASH' | 'OFFLINE_UPI' | null>(null);

        const generateLink = async () => {
            setGenerating(true);
            try {
                const res = await api.post(`/manager/orders/${orderId}/payment-link`);
                setLinkUrl(res.data.shortUrl);
                toast.success('Payment link generated!');
            } catch (e: any) {
                toast.error(e?.response?.data?.error || 'Failed to generate link');
            } finally { setGenerating(false); }
        };

        const confirmPayment = async () => {
            if (!payMode) return;
            setConfirming(true);
            try {
                await api.post(`/manager/orders/${orderId}/confirm-payment`, { collectionMode: payMode });
                toast.success('Payment confirmed & booking finalized!');
                handleSuccess();
            } catch (e: any) {
                toast.error(e?.response?.data?.error || 'Failed to confirm payment');
            } finally { setConfirming(false); }
        };

        const copyLink = () => {
            if (linkUrl) { navigator.clipboard.writeText(linkUrl); toast.success('Copied!'); }
        };

        const sendWhatsApp = async () => {
            setWhatsappSending(true);
            try {
                const res = await api.post(`/manager/orders/${orderId}/send-whatsapp-link`);
                toast.success(res.data.message || 'Payment link sent via WhatsApp!');
            } catch (e: any) {
                toast.error(e?.response?.data?.error || 'Failed to send WhatsApp message');
            } finally {
                setWhatsappSending(false);
            }
        };

        return (
            <div className="space-y-4">
                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-purple-600" />
                        <h4 className="font-semibold text-sm text-gray-800">Send Razorpay Payment Link</h4>
                    </div>
                    {linkUrl ? (
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <input value={linkUrl} readOnly className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 font-mono" />
                                <button onClick={copyLink} className="px-3 py-2 border rounded-lg hover:bg-gray-50"><Copy className="w-4 h-4" /></button>
                                <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-2 border rounded-lg hover:bg-gray-50">
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>
                            <button
                                onClick={sendWhatsApp}
                                disabled={whatsappSending}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                            >
                                {whatsappSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                                {whatsappSending ? 'Sending...' : 'Send Payment Link via WhatsApp'}
                            </button>
                        </div>
                    ) : (
                        <button onClick={generateLink} disabled={generating}
                            className="w-full btn-primary flex items-center justify-center gap-2">
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                            Generate & Send Payment Link
                        </button>
                    )}
                </div>

                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <Banknote className="w-4 h-4 text-emerald-600" />
                        <h4 className="font-semibold text-sm text-gray-800">Record Offline Payment</h4>
                    </div>
                    <div className="flex gap-2">
                        {(['OFFLINE_CASH', 'OFFLINE_UPI'] as const).map(m => (
                            <button key={m} onClick={() => setPayMode(m)}
                                className={`flex-1 text-sm py-2 px-3 rounded-lg border font-medium transition-colors
                                    ${payMode === m ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 hover:border-emerald-400'}`}>
                                {m === 'OFFLINE_CASH' ? '💵 Cash' : '📱 UPI'}
                            </button>
                        ))}
                    </div>
                    {payMode && payMode !== 'RAZORPAY_LINK' && (
                        <button onClick={confirmPayment} disabled={confirming}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
                            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Confirm {payMode === 'OFFLINE_CASH' ? 'Cash' : 'UPI'} Payment & Finalize
                        </button>
                    )}
                </div>
            </div>
        );
    }

    function StepCampSelect() {
        const [camps, setCamps] = useState<any[]>([]);
        const [loading, setLoading] = useState(true);

        useEffect(() => {
            api.get('/camps/active').then(res => {
                setCamps(res.data);
            }).catch(() => toast.error('Failed to load camps')).finally(() => setLoading(false));
        }, []);

        if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#4b2192]" /></div>;
        if (camps.length === 0) return <div className="text-center py-12 text-gray-500">No active camps available</div>;

        return (
            <div className="space-y-3">
                <h3 className="text-lg font-bold text-gray-900">Select a Health Camp</h3>
                <div className="grid gap-3">
                    {camps.map(camp => {
                        const isSelected = selectedCamp?.id === camp.id;
                        const startDate = new Date(camp.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                        const endDate = new Date(camp.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                        return (
                            <button
                                key={camp.id}
                                onClick={() => setSelectedCamp(camp)}
                                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                                    isSelected ? 'border-[#4b2192] bg-purple-50 shadow-md' : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                                }`}
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h4 className="font-bold text-gray-900">{camp.name}</h4>
                                        <p className="text-sm text-gray-500 mt-1">📍 {camp.location}, {camp.city} - {camp.pincode}</p>
                                        <p className="text-sm text-gray-500">📅 {startDate} → {endDate}</p>
                                        <p className="text-xs text-gray-400 mt-1">{camp._count?.items || camp.items?.length || 0} tests included</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-lg font-black text-[#4b2192]">₹{camp.price}</p>
                                        {isSelected && <span className="text-xs text-green-600 font-bold">✓ Selected</span>}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    function StepCampPatient() {
        const [patients, setPatients] = useState<any[]>([]);
        const [loading, setLoading] = useState(true);
        const [showAddForm, setShowAddForm] = useState(false);
        const [newPatient, setNewPatient] = useState({ name: '', relation: 'Spouse', age: '', gender: 'Male' });
        const [adding, setAdding] = useState(false);

        const fetchPatients = () => {
            if (!selectedUser) return;
            setLoading(true);
            api.get(`/manager/users/${selectedUser.id}/patients`).then(res => {
                setPatients(res.data);
            }).catch(() => {}).finally(() => setLoading(false));
        };

        useEffect(() => { fetchPatients(); }, [selectedUser]);

        const handleAddPatient = async () => {
            if (!newPatient.name || !newPatient.age) { toast.error('Name and age are required'); return; }
            setAdding(true);
            try {
                await api.post(`/manager/users/${selectedUser!.id}/patients`, {
                    name: newPatient.name,
                    relation: newPatient.relation,
                    age: parseInt(newPatient.age),
                    gender: newPatient.gender,
                });
                toast.success('Patient added');
                setNewPatient({ name: '', relation: 'Spouse', age: '', gender: 'Male' });
                setShowAddForm(false);
                fetchPatients();
            } catch (e: any) {
                toast.error(e?.response?.data?.error || 'Failed to add patient');
            } finally {
                setAdding(false);
            }
        };

        if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#4b2192]" /></div>;

        return (
            <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900">Select Patient</h3>

                {/* Self option */}
                <button
                    onClick={() => { setCampPatientId('self'); setCampDob(''); }}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                        campPatientId === 'self' ? 'border-[#4b2192] bg-purple-50' : 'border-gray-200 hover:border-purple-300'
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            campPatientId === 'self' ? 'border-[#4b2192]' : 'border-gray-300'
                        }`}>
                            {campPatientId === 'self' && <div className="w-3 h-3 rounded-full bg-[#4b2192]" />}
                        </div>
                        <div>
                            <p className="font-bold text-gray-900">{selectedUser?.name} (Self)</p>
                            <p className="text-xs text-gray-500">Primary account holder</p>
                        </div>
                    </div>
                </button>

                {/* Family members */}
                {patients.map(p => (
                    <button
                        key={p.id}
                        onClick={() => { setCampPatientId(p.id); setCampDob(p.dob ? p.dob.split('T')[0] : ''); }}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                            campPatientId === p.id ? 'border-[#4b2192] bg-purple-50' : 'border-gray-200 hover:border-purple-300'
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                campPatientId === p.id ? 'border-[#4b2192]' : 'border-gray-300'
                            }`}>
                                {campPatientId === p.id && <div className="w-3 h-3 rounded-full bg-[#4b2192]" />}
                            </div>
                            <div>
                                <p className="font-bold text-gray-900">{p.name}</p>
                                <p className="text-xs text-gray-500">{p.relation} · {p.age}y · {p.gender}</p>
                            </div>
                        </div>
                    </button>
                ))}

                {/* DOB input for selected patient (if missing) */}
                {campPatientId && (
                    <div className="mt-3">
                        <label className="text-sm font-medium text-gray-700 block mb-1">Date of Birth {campDob ? '' : '(required for registration)'}</label>
                        <input
                            type="date"
                            value={campDob}
                            onChange={e => setCampDob(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none"
                        />
                    </div>
                )}

                {/* Add new patient */}
                {!showAddForm ? (
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="text-sm text-[#4b2192] font-bold hover:underline"
                    >
                        + Add a new patient
                    </button>
                ) : (
                    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                        <h4 className="font-bold text-sm text-gray-700">Add New Patient</h4>
                        <input placeholder="Patient Name" value={newPatient.name} onChange={e => setNewPatient({...newPatient, name: e.target.value})} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        <div className="grid grid-cols-3 gap-2">
                            <select value={newPatient.relation} onChange={e => setNewPatient({...newPatient, relation: e.target.value})} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                                <option>Spouse</option><option>Child</option><option>Parent</option><option>Sibling</option><option>Other</option>
                            </select>
                            <input type="number" placeholder="Age" value={newPatient.age} onChange={e => setNewPatient({...newPatient, age: e.target.value})} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                            <select value={newPatient.gender} onChange={e => setNewPatient({...newPatient, gender: e.target.value})} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                                <option>Male</option><option>Female</option><option>Other</option>
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleAddPatient} disabled={adding} className="px-4 py-2 rounded-lg bg-[#4b2192] text-white text-sm font-bold disabled:opacity-50">
                                {adding ? 'Adding...' : 'Add Patient'}
                            </button>
                            <button onClick={() => setShowAddForm(false)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-bold">Cancel</button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    function StepCampConfirm() {
        if (campResult) {
            return (
                <div className="space-y-6">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                        <div className="text-4xl mb-3">✅</div>
                        <h3 className="text-lg font-bold text-green-800">Camp Registration Order Created!</h3>
                        <p className="text-sm text-green-600 mt-1">Order ID: {campResult.orderId.slice(0, 8)}...</p>
                    </div>
                    <ResultActions orderId={campResult.orderId} bookingId={campResult.bookingId} />
                    <div className="border-t pt-4">
                        <button
                            onClick={() => {
                                setCampStep(2);
                                setCampPatientId('');
                                setCampDob('');
                                setCampPricingTier('SINGLE');
                                setCampResult(null);
                            }}
                            className="w-full py-3 rounded-xl text-sm font-bold bg-purple-100 text-[#4b2192] hover:bg-purple-200 transition-all"
                        >
                            📋 Register Another Patient for This Camp
                        </button>
                    </div>
                </div>
            );
        }

        const campStartDate = selectedCamp ? new Date(selectedCamp.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        const patientLabel = campPatientId === 'self' ? `${selectedUser?.name} (Self)` : '';

        const createCampOrder = async () => {
            setCampCreating(true);
            try {
                const res = await api.post('/manager/camps/orders', {
                    userId: selectedUser!.id,
                    campId: selectedCamp.id,
                    patientId: campPatientId,
                    dob: campDob || undefined,
                    pricingTier: campPricingTier,
                });
                setCampResult({ orderId: res.data.managerOrder.id, bookingId: res.data.booking.id });
                toast.success('Camp registration order created!');
            } catch (e: any) {
                toast.error(e?.response?.data?.error || 'Failed to create camp order');
            } finally {
                setCampCreating(false);
            }
        };

        return (
            <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900">Confirm Camp Registration</h3>
                
                <div className="space-y-3">
                    <label className="block text-sm font-bold text-gray-900">Select Pricing Tier</label>
                    <div className="flex flex-col gap-2">
                        <button
                            type="button"
                            onClick={() => setCampPricingTier('SINGLE')}
                            className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${campPricingTier === 'SINGLE' ? 'border-[#4b2192] bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                        >
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${campPricingTier === 'SINGLE' ? 'border-[#4b2192]' : 'border-gray-300'}`}>
                                {campPricingTier === 'SINGLE' && <div className="w-3 h-3 rounded-full bg-[#4b2192]" />}
                            </div>
                            <span className="font-bold text-gray-900">Single Patient — ₹{selectedCamp?.price}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setCampPricingTier('FAMILY')}
                            className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${campPricingTier === 'FAMILY' ? 'border-[#4b2192] bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                        >
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${campPricingTier === 'FAMILY' ? 'border-[#4b2192]' : 'border-gray-300'}`}>
                                {campPricingTier === 'FAMILY' && <div className="w-3 h-3 rounded-full bg-[#4b2192]" />}
                            </div>
                            <span className="font-bold text-gray-900">Family (2+ Patients) — ₹{selectedCamp?.familyPrice}/person</span>
                        </button>
                    </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">Customer</span>
                        <span className="font-medium">{selectedUser?.name} ({selectedUser?.mobile})</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">Camp</span>
                        <span className="font-medium">{selectedCamp?.name}</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">Location</span>
                        <span className="font-medium">{selectedCamp?.location}, {selectedCamp?.city}</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">Date</span>
                        <span className="font-medium">{campStartDate}</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">Patient</span>
                        <span className="font-medium">{patientLabel || campPatientId.slice(0, 8) + '...'}</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between text-sm">
                        <span className="text-gray-500">Tests</span>
                        <span className="font-medium">{selectedCamp?.items?.length || selectedCamp?._count?.items || 0} tests included</span>
                    </div>
                    <div className="px-4 py-3 flex justify-between text-sm font-bold">
                        <span className="text-gray-700">Total</span>
                        <span className="text-[#4b2192]">₹{campPricingTier === 'SINGLE' ? selectedCamp?.price : selectedCamp?.familyPrice}</span>
                    </div>
                </div>

                <button
                    onClick={createCampOrder}
                    disabled={campCreating}
                    className="w-full py-3.5 rounded-xl text-sm font-bold bg-[#4b2192] text-white hover:bg-[#3a1a73] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                    {campCreating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Camp Order'}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">Payment Links</h1>
                    <p className="text-gray-500 mt-1 text-sm">Create manager-driven bookings and generate payment links</p>
                </div>
                <button onClick={() => setShowWizard(true)}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium w-full sm:w-auto bg-[#4b2192] hover:bg-purple-900 transition-colors">
                    <Plus className="h-4 w-4" /> Create Order
                </button>
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900">My Orders</h2>
                    <button onClick={() => setListRefresh(v => !v)} className="text-xs text-purple-600 hover:underline">Refresh</button>
                </div>
                <OrderList refresh={listRefresh} />
            </div>

            {/* Wizard Modal */}
            {showWizard && (
                <FormProvider {...methods}>
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
                        <div className="sticky top-0 bg-white px-6 pt-6 pb-4 border-b border-gray-100 z-10">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-gray-900">New Manager Order</h2>
                                <button onClick={resetWizard} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                                    <X className="w-5 h-5 text-gray-600" />
                                </button>
                            </div>
                            
                            <div className="flex gap-2 mb-6">
                                <button
                                    onClick={() => { setOrderMode('HOME_COLLECTION'); }}
                                    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${orderMode === 'HOME_COLLECTION' ? 'bg-[#4b2192] text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                >
                                    🏠 Home Collection
                                </button>
                                <button
                                    onClick={() => { setOrderMode('CAMP'); }}
                                    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${orderMode === 'CAMP' ? 'bg-[#4b2192] text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                >
                                    🏕️ Camp Registration
                                </button>
                            </div>

                            {orderMode === 'HOME_COLLECTION' && (
                                <StepIndicator current={step} onStepClick={(s) => setStep(s)} />
                            )}
                        </div>
                        <div className="p-6">
                            {orderMode === 'HOME_COLLECTION' && (
                                <>
                                    {step === 0 && (
                                        selectedUser ? (
                                            <div className="space-y-4">
                                                <h2 className="text-lg font-semibold text-gray-800">Selected Customer</h2>
                                                <div className="flex items-center justify-between p-4 bg-purple-50 border border-purple-200 rounded-xl">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-purple-200 flex items-center justify-center text-purple-700 font-bold text-sm">
                                                            {(selectedUser.name || 'U')[0].toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-gray-900">{selectedUser.name || 'Unnamed'}</p>
                                                            <p className="text-sm text-gray-500">{selectedUser.mobile}</p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => { methods.reset(); }}
                                                        className="text-sm text-purple-700 hover:text-purple-900 font-medium px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors"
                                                    >
                                                        Change
                                                    </button>
                                                </div>
                                                <button onClick={() => setStep(1)}
                                                    className="btn-primary w-full flex items-center justify-center gap-1">
                                                    Continue <ChevronRight className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <StepCustomer onNext={() => { setStep(1); }} />
                                        )
                                    )}
                                    {step === 1 && selectedUser && (
                                        <StepPatientsAddress
                                            user={selectedUser}
                                            onNext={() => setStep(2)}
                                            onBack={() => setStep(0)}
                                        />
                                    )}
                                    {step === 2 && selectedUser && (
                                        <StepTests
                                            user={selectedUser}
                                            onNext={() => setStep(3)}
                                            onBack={() => setStep(1)}
                                        />
                                    )}
                                    {step === 3 && selectedAddress && (
                                        <StepSlot
                                            onNext={() => setStep(4)}
                                            onBack={() => setStep(2)}
                                        />
                                    )}
                                    {step === 4 && selectedUser && selectedAddress && (
                                        <StepConfirm
                                            onBack={() => setStep(3)}
                                            onSuccess={handleSuccess}
                                        />
                                    )}
                                </>
                            )}

                            {orderMode === 'CAMP' && (
                                <div className="space-y-6">
                                    <div className="flex items-center gap-2 mb-8">
                                        {['Customer', 'Select Camp', 'Patient', 'Confirm'].map((label, i) => (
                                            <div key={label} className="flex items-center gap-2">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                                                    i < campStep ? 'bg-green-500 text-white' :
                                                    i === campStep ? 'bg-[#4b2192] text-white shadow-lg' :
                                                    'bg-gray-200 text-gray-500'
                                                }`}>{i < campStep ? '✓' : i + 1}</div>
                                                <span className={`text-sm font-medium hidden sm:inline ${i === campStep ? 'text-[#4b2192]' : 'text-gray-400'}`}>{label}</span>
                                                {i < 3 && <div className={`w-8 h-0.5 ${i < campStep ? 'bg-green-500' : 'bg-gray-200'}`} />}
                                            </div>
                                        ))}
                                    </div>

                                    {campStep === 0 && (
                                        selectedUser ? (
                                            <div className="space-y-4">
                                                <h2 className="text-lg font-semibold text-gray-800">Selected Customer</h2>
                                                <div className="flex items-center justify-between p-4 bg-purple-50 border border-purple-200 rounded-xl">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-purple-200 flex items-center justify-center text-purple-700 font-bold text-sm">
                                                            {(selectedUser.name || 'U')[0].toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-gray-900">{selectedUser.name || 'Unnamed'}</p>
                                                            <p className="text-sm text-gray-500">{selectedUser.mobile}</p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => { methods.reset(); }}
                                                        className="text-sm text-purple-700 hover:text-purple-900 font-medium px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors"
                                                    >
                                                        Change
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <StepCustomer onNext={() => {}} />
                                        )
                                    )}

                                    {campStep === 1 && <StepCampSelect />}
                                    {campStep === 2 && <StepCampPatient />}
                                    {campStep === 3 && <StepCampConfirm />}

                                    {!campResult && (
                                        <div className="flex justify-between pt-4">
                                            <button
                                                onClick={() => setCampStep(Math.max(0, campStep - 1))}
                                                disabled={campStep === 0}
                                                className="px-6 py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition-all"
                                            >
                                                ← Back
                                            </button>
                                            {campStep < 3 && (
                                                <button
                                                    onClick={() => setCampStep(campStep + 1)}
                                                    disabled={
                                                        (campStep === 0 && !selectedUser) ||
                                                        (campStep === 1 && !selectedCamp) ||
                                                        (campStep === 2 && !campPatientId)
                                                    }
                                                    className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#4b2192] text-white hover:bg-[#3a1a73] disabled:opacity-40 transition-all"
                                                >
                                                    Next →
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                </FormProvider>
            )}

            {/* Global Styles (scoped inline classes) */}
            <style jsx global>{`
                .btn-primary {
                    background-color: #4b2192;
                    color: white;
                    padding: 0.5rem 1rem;
                    border-radius: 0.5rem;
                    font-size: 0.875rem;
                    font-weight: 600;
                    transition: background-color 0.15s;
                    cursor: pointer;
                }
                .btn-primary:hover { background-color: #3b1772; }
                .btn-ghost {
                    background-color: transparent;
                    border: 1px solid #e5e7eb;
                    color: #374151;
                    padding: 0.5rem 0.75rem;
                    border-radius: 0.5rem;
                    font-size: 0.875rem;
                    font-weight: 500;
                    transition: background-color 0.15s;
                    cursor: pointer;
                }
                .btn-ghost:hover { background-color: #f9fafb; }
                .input-sm {
                    border: 1px solid #d1d5db;
                    border-radius: 0.5rem;
                    padding: 0.5rem 0.75rem;
                    font-size: 0.875rem;
                    width: 100%;
                    outline: none;
                }
                .input-sm:focus { box-shadow: 0 0 0 2px #c4b5fd; }
            `}</style>
        </div>
    );
}
