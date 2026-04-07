'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Plus, Copy, ChevronRight, ChevronLeft, Search,
    CheckCircle, X, User, MapPin, FlaskConical, Calendar,
    CreditCard, Smartphone, Banknote, ExternalLink, Loader2,
    AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserResult {
    id: string;
    name: string | null;
    mobile: string;
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
    slot_start_time: string;
    slot_end_time: string;
}

interface CartItem {
    testCode: string;
    testName: string;
    price: number;
    patientId: string; // 'self' | actual patient id
}

interface ManagerOrder {
    id: string;
    bookingId: string;
    totalAmount: number;
    status: string;
    razorpayLinkUrl?: string;
    customer: { name: string | null; mobile: string };
    createdAt: string;
}

// ─── Step indicators ─────────────────────────────────────────────────────────

const STEPS = [
    { label: 'Customer', icon: User },
    { label: 'Patients & Address', icon: MapPin },
    { label: 'Tests', icon: FlaskConical },
    { label: 'Slot', icon: Calendar },
    { label: 'Confirm', icon: CreditCard },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
    return (
        <nav className="flex items-center justify-center gap-0 mb-8 overflow-x-auto">
            {STEPS.map((step, i) => {
                const Icon = step.icon;
                const done = i < current;
                const active = i === current;
                return (
                    <div key={i} className="flex items-center">
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all
                            ${active ? 'bg-[#4b2192] text-white shadow-md' : done ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-400'}`}>
                            {done ? <CheckCircle className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                            <span className="hidden sm:inline">{step.label}</span>
                        </div>
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

function StepCustomer({ onNext }: { onNext: (u: UserResult) => void }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<UserResult[]>([]);
    const [loading, setLoading] = useState(false);

    const search = useCallback(async () => {
        if (query.length < 3) return;
        setLoading(true);
        try {
            const res = await api.get('/manager/users/search', { params: { mobile: query } });
            setResults(res.data);
        } catch { toast.error('Search failed'); }
        finally { setLoading(false); }
    }, [query]);

    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Search Customer</h2>
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && search()}
                        placeholder="Search by mobile number…"
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 outline-none"
                    />
                </div>
                <button onClick={search} disabled={loading}
                    className="px-4 py-2.5 rounded-lg text-white text-sm font-medium bg-[#4b2192] hover:bg-purple-900 disabled:opacity-60 flex items-center gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                </button>
            </div>
            {results.length > 0 && (
                <div className="divide-y border border-gray-200 rounded-lg overflow-hidden">
                    {results.map(u => (
                        <button key={u.id} onClick={() => onNext(u)}
                            className="w-full text-left px-4 py-3 hover:bg-purple-50 transition-colors flex items-center justify-between">
                            <div>
                                <p className="font-medium text-gray-900">{u.name || 'Unnamed'}</p>
                                <p className="text-sm text-gray-500">{u.mobile}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                        </button>
                    ))}
                </div>
            )}
            {results.length === 0 && query.length >= 3 && !loading && (
                <p className="text-sm text-gray-500 text-center py-4">No customers found for this number.</p>
            )}
        </div>
    );
}

// ─── Step 2: Patients & Address ────────────────────────────────────────────────

function StepPatientsAddress({
    user, onNext, onBack
}: {
    user: UserResult;
    onNext: (patientId: string, address: Address) => void;
    onBack: () => void;
}) {
    const [patients, setPatients] = useState<Patient[]>([]);
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [selectedPatient, setSelectedPatient] = useState<string>('');
    const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
    const [showAddPatient, setShowAddPatient] = useState(false);
    const [showAddAddress, setShowAddAddress] = useState(false);
    const [saving, setSaving] = useState(false);

    const [pForm, setPForm] = useState({ name: '', relation: '', age: '', gender: 'Male' });
    const [aForm, setAForm] = useState({ line1: '', city: '', pincode: '', lat: '', long: '' });

    const refresh = useCallback(async () => {
        const [pi, ai] = await Promise.all([
            api.get(`/manager/users/${user.id}/patients`),
            api.get(`/manager/users/${user.id}/addresses`),
        ]);
        setPatients(pi.data);
        setAddresses(ai.data);
    }, [user.id]);

    useEffect(() => { refresh(); }, [refresh]);

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
        setSaving(true);
        try {
            await api.post(`/manager/users/${user.id}/addresses`, aForm);
            toast.success('Address added');
            setShowAddAddress(false);
            setAForm({ line1: '', city: '', pincode: '', lat: '', long: '' });
            await refresh();
        } catch (e: any) { toast.error(e?.response?.data?.error || 'Failed to add address'); }
        finally { setSaving(false); }
    };

    const canProceed = (selectedPatient === 'self' || selectedPatient !== '') && selectedAddress !== null;

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

            {/* Patients */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Patient (for billing)</h3>
                    <button onClick={() => setShowAddPatient(v => !v)}
                        className="text-xs text-purple-700 font-medium flex items-center gap-1 hover:underline">
                        <Plus className="w-3 h-3" /> Add Patient
                    </button>
                </div>
                {showAddPatient && (
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-3 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <input value={pForm.name} onChange={e => setPForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Full name" className="input-sm" />
                            <input value={pForm.relation} onChange={e => setPForm(f => ({ ...f, relation: e.target.value }))}
                                placeholder="Relation (e.g. Mother)" className="input-sm" />
                            <input type="number" value={pForm.age} onChange={e => setPForm(f => ({ ...f, age: e.target.value }))}
                                placeholder="Age" className="input-sm" />
                            <select value={pForm.gender} onChange={e => setPForm(f => ({ ...f, gender: e.target.value }))} className="input-sm">
                                <option>Male</option><option>Female</option><option>Other</option>
                            </select>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setShowAddPatient(false)} className="btn-ghost text-xs">Cancel</button>
                            <button onClick={addPatient} disabled={saving} className="btn-primary text-xs">
                                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                            </button>
                        </div>
                    </div>
                )}
                <div className="space-y-2">
                    {/* Self option */}
                    <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors
                        ${selectedPatient === 'self' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}>
                        <input type="radio" name="patient" value="self"
                            checked={selectedPatient === 'self'}
                            onChange={() => setSelectedPatient('self')}
                            className="accent-purple-700" />
                        <div>
                            <p className="font-medium text-sm">{user.name || 'Customer'}</p>
                            <p className="text-xs text-gray-500">Self</p>
                        </div>
                    </label>
                    {patients.map(p => (
                        <label key={p.id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors
                            ${selectedPatient === p.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}>
                            <input type="radio" name="patient" value={p.id}
                                checked={selectedPatient === p.id}
                                onChange={() => setSelectedPatient(p.id)}
                                className="accent-purple-700" />
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
                        <input value={aForm.line1} onChange={e => setAForm(f => ({ ...f, line1: e.target.value }))}
                            placeholder="Address Line 1" className="input-sm w-full" />
                        <div className="grid grid-cols-2 gap-3">
                            <input value={aForm.city} onChange={e => setAForm(f => ({ ...f, city: e.target.value }))}
                                placeholder="City" className="input-sm" />
                            <input value={aForm.pincode} onChange={e => setAForm(f => ({ ...f, pincode: e.target.value }))}
                                placeholder="Pincode (6 digits)" className="input-sm" />
                            <input value={aForm.lat} onChange={e => setAForm(f => ({ ...f, lat: e.target.value }))}
                                placeholder="Latitude (optional)" className="input-sm" />
                            <input value={aForm.long} onChange={e => setAForm(f => ({ ...f, long: e.target.value }))}
                                placeholder="Longitude (optional)" className="input-sm" />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setShowAddAddress(false)} className="btn-ghost text-xs">Cancel</button>
                            <button onClick={addAddress} disabled={saving} className="btn-primary text-xs">
                                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                            </button>
                        </div>
                    </div>
                )}
                <div className="space-y-2">
                    {addresses.map(a => (
                        <label key={a.id} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors
                            ${selectedAddress?.id === a.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}>
                            <input type="radio" name="address" value={a.id}
                                checked={selectedAddress?.id === a.id}
                                onChange={() => setSelectedAddress(a)}
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
                <button disabled={!canProceed} onClick={() => onNext(selectedPatient, selectedAddress!)}
                    className="btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-50">
                    Continue <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// ─── Step 3: Test Selection ────────────────────────────────────────────────────

function StepTests({
    patientId, user, cart, setCart, onNext, onBack
}: {
    patientId: string; user: UserResult;
    cart: CartItem[]; setCart: (c: CartItem[]) => void;
    onNext: () => void; onBack: () => void;
}) {
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<CatalogItem[]>([]);
    const [loading, setLoading] = useState(false);

    const search = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/catalog/products', { params: { search: query || undefined } });
            setItems(res.data.products || []);
        } catch { toast.error('Failed to fetch catalog'); }
        finally { setLoading(false); }
    }, [query]);

    useEffect(() => { search(); }, []); // load all on mount

    const inCart = (code: string) => cart.some(c => c.testCode === code);

    const addToCart = (item: CatalogItem) => {
        if (inCart(item.partnerCode)) {
            setCart(cart.filter(c => c.testCode !== item.partnerCode));
        } else {
            setCart([...cart, { testCode: item.partnerCode, testName: item.name, price: item.price, patientId }]);
        }
    };

    const total = cart.reduce((s, c) => s + c.price, 0);

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
                {items.map(item => (
                    <label key={item.id} className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors
                        ${inCart(item.partnerCode) ? 'bg-purple-50 border border-purple-200' : 'hover:bg-gray-50'}`}>
                        <div className="flex items-center gap-3">
                            <input type="checkbox" checked={inCart(item.partnerCode)} onChange={() => addToCart(item)}
                                className="accent-purple-700 w-4 h-4" />
                            <div>
                                <p className="text-sm font-medium text-gray-900">{item.name}</p>
                                <p className="text-xs text-gray-400 uppercase">{item.type}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-semibold text-purple-700">₹{item.price}</p>
                            {item.mrp && <p className="text-xs text-gray-400 line-through">₹{item.mrp}</p>}
                        </div>
                    </label>
                ))}
                {items.length === 0 && !loading && (
                    <p className="text-sm text-gray-400 text-center py-4">No items found.</p>
                )}
            </div>

            {cart.length > 0 && (
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                    <h4 className="text-sm font-semibold text-purple-800 mb-2">Selected ({cart.length})</h4>
                    {cart.map(c => (
                        <div key={c.testCode} className="flex justify-between text-sm py-0.5">
                            <span className="text-gray-700">{c.testName}</span>
                            <span className="font-medium">₹{c.price}</span>
                        </div>
                    ))}
                    <div className="border-t border-purple-200 mt-2 pt-2 flex justify-between font-bold text-purple-900">
                        <span>Total</span>
                        <span>₹{total}</span>
                    </div>
                </div>
            )}

            <div className="flex gap-3 pt-2">
                <button onClick={onBack} className="btn-ghost flex items-center gap-1">
                    <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button disabled={cart.length === 0} onClick={onNext}
                    className="btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-50">
                    Continue <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// ─── Step 4: Slot ──────────────────────────────────────────────────────────────

function StepSlot({
    address, cart, slotDate, slotTime, setSlotDate, setSlotTime, onNext, onBack
}: {
    address: Address; cart: CartItem[];
    slotDate: string; slotTime: string;
    setSlotDate: (d: string) => void;
    setSlotTime: (t: string) => void;
    onNext: () => void; onBack: () => void;
}) {
    const [slots, setSlots] = useState<Slot[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchSlots = useCallback(async () => {
        if (!slotDate) return;
        setLoading(true);
        try {
            const res = await api.post('/manager/slots', {
                lat: address.lat || '0', long: address.long || '0',
                zipcode: address.pincode, date: slotDate,
                items: cart.map(c => ({ testCode: c.testCode }))
            });
            const raw = Array.isArray(res.data) ? res.data : (res.data?.slots || res.data?.data || []);
            setSlots(raw);
        } catch { toast.error('Failed to fetch slots'); setSlots([]); }
        finally { setLoading(false); }
    }, [slotDate, address, cart]);

    useEffect(() => { if (slotDate) fetchSlots(); }, [slotDate, fetchSlots]);

    const today = new Date().toISOString().split('T')[0];

    return (
        <div className="space-y-4">
            <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Select Date</label>
                <input type="date" value={slotDate} min={today}
                    onChange={e => { setSlotDate(e.target.value); setSlotTime(''); }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none" />
            </div>

            {slotDate && (
                <div>
                    <label className="text-sm font-medium text-gray-700 block mb-2">Choose Time Slot</label>
                    {loading ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-purple-500" /></div>
                    ) : slots.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {slots.map(s => {
                                const label = `${s.slot_start_time} – ${s.slot_end_time}`;
                                const selected = slotTime === s.stm_id;
                                return (
                                    <button key={s.stm_id} onClick={() => setSlotTime(s.stm_id)}
                                        className={`text-sm py-2.5 px-3 rounded-lg border font-medium transition-colors
                                            ${selected ? 'bg-[#4b2192] text-white border-purple-700' : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'}`}>
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center py-6">
                            <AlertCircle className="w-8 h-8 text-orange-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">No slots available for this date. Try a different date.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Fallback: manual slot entry */}
            <div>
                <label className="text-sm font-medium text-gray-500 block mb-1">Or enter slot manually</label>
                <input value={slotTime} onChange={e => setSlotTime(e.target.value)}
                    placeholder="e.g. 07:00 AM - 09:00 AM"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-200 outline-none" />
            </div>

            <div className="flex gap-3 pt-2">
                <button onClick={onBack} className="btn-ghost flex items-center gap-1">
                    <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button disabled={!slotDate || !slotTime} onClick={onNext}
                    className="btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-50">
                    Continue <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// ─── Step 5: Confirm & Pay ────────────────────────────────────────────────────

function StepConfirm({
    user, address, cart, slotDate, slotTime, onBack, onSuccess
}: {
    user: UserResult; address: Address; cart: CartItem[];
    slotDate: string; slotTime: string;
    onBack: () => void; onSuccess: () => void;
}) {
    const [creating, setCreating] = useState(false);
    const [result, setResult] = useState<{ orderId: string; bookingId: string } | null>(null);
    const [linkUrl, setLinkUrl] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [payMode, setPayMode] = useState<'RAZORPAY_LINK' | 'OFFLINE_CASH' | 'OFFLINE_UPI' | null>(null);

    const total = cart.reduce((s, c) => s + c.price, 0);

    const createOrder = async () => {
        setCreating(true);
        try {
            const res = await api.post('/manager/orders', {
                userId: user.id,
                addressId: address.id,
                slotDate, slotTime,
                items: cart.map(c => ({ testCode: c.testCode, patientId: c.patientId }))
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
                    <span className="font-medium">{slotDate} · {slotTime}</span>
                </div>
                <div className="px-4 py-3 space-y-1">
                    {cart.map(c => (
                        <div key={c.testCode} className="flex justify-between text-sm">
                            <span className="text-gray-700">{c.testName}</span>
                            <span className="font-medium">₹{c.price}</span>
                        </div>
                    ))}
                </div>
                <div className="px-4 py-3 flex justify-between font-bold text-purple-900">
                    <span>Total</span>
                    <span>₹{total}</span>
                </div>
            </div>

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
                            <div className="flex gap-2">
                                <input value={linkUrl} readOnly className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 font-mono" />
                                <button onClick={copyLink} className="px-3 py-2 border rounded-lg hover:bg-gray-50"><Copy className="w-4 h-4" /></button>
                                <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-2 border rounded-lg hover:bg-gray-50">
                                    <ExternalLink className="w-4 h-4" />
                                </a>
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
    BOOKING_FAILED: 'bg-red-100 text-red-700',
    REFUNDED: 'bg-orange-100 text-orange-700',
};

function OrderList({ refresh }: { refresh: boolean }) {
    const [orders, setOrders] = useState<ManagerOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState<string | null>(null);

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
                                {['CREATED', 'SENT'].includes(order.status) && (
                                    <button onClick={() => generateLink(order.id)} disabled={generating === order.id}
                                        className="text-xs px-3 py-1.5 rounded-lg bg-[#4b2192] text-white hover:bg-purple-900 disabled:opacity-60 flex items-center gap-1 ml-auto">
                                        {generating === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />}
                                        {order.status === 'SENT' ? 'Resend' : 'Send'} Link
                                    </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentLinksPage() {
    const [showWizard, setShowWizard] = useState(false);
    const [step, setStep] = useState(0);
    const [listRefresh, setListRefresh] = useState(false);

    // Wizard state
    const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
    const [selectedPatientId, setSelectedPatientId] = useState('');
    const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [slotDate, setSlotDate] = useState('');
    const [slotTime, setSlotTime] = useState('');

    const resetWizard = () => {
        setStep(0); setSelectedUser(null); setSelectedPatientId('');
        setSelectedAddress(null); setCart([]); setSlotDate(''); setSlotTime('');
        setShowWizard(false);
    };

    const handleSuccess = () => {
        resetWizard();
        setListRefresh(v => !v);
        toast.success('🎉 Order finalized successfully!');
    };

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
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
                        <div className="sticky top-0 bg-white px-6 pt-6 pb-4 border-b border-gray-100 z-10">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-gray-900">New Manager Order</h2>
                                <button onClick={resetWizard} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                                    <X className="w-5 h-5 text-gray-600" />
                                </button>
                            </div>
                            <StepIndicator current={step} />
                        </div>
                        <div className="p-6">
                            {step === 0 && (
                                <StepCustomer onNext={user => { setSelectedUser(user); setStep(1); }} />
                            )}
                            {step === 1 && selectedUser && (
                                <StepPatientsAddress
                                    user={selectedUser}
                                    onNext={(patId, addr) => { setSelectedPatientId(patId); setSelectedAddress(addr); setStep(2); }}
                                    onBack={() => setStep(0)}
                                />
                            )}
                            {step === 2 && selectedUser && (
                                <StepTests
                                    patientId={selectedPatientId}
                                    user={selectedUser}
                                    cart={cart}
                                    setCart={setCart}
                                    onNext={() => setStep(3)}
                                    onBack={() => setStep(1)}
                                />
                            )}
                            {step === 3 && selectedAddress && (
                                <StepSlot
                                    address={selectedAddress}
                                    cart={cart}
                                    slotDate={slotDate}
                                    slotTime={slotTime}
                                    setSlotDate={setSlotDate}
                                    setSlotTime={setSlotTime}
                                    onNext={() => setStep(4)}
                                    onBack={() => setStep(2)}
                                />
                            )}
                            {step === 4 && selectedUser && selectedAddress && (
                                <StepConfirm
                                    user={selectedUser}
                                    address={selectedAddress}
                                    cart={cart}
                                    slotDate={slotDate}
                                    slotTime={slotTime}
                                    onBack={() => setStep(3)}
                                    onSuccess={handleSuccess}
                                />
                            )}
                        </div>
                    </div>
                </div>
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
