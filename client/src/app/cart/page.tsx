"use client";

import { Header } from '@/components/Header';
import { Trash2, Loader2, ShoppingBag, MapPin, Calendar, Ticket, Wallet, Check, X, FileText, ChevronDown, ChevronUp, Tag, Percent } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useCart } from '@/contexts/CartContext';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { ProfileCompletionDialog } from '@/components/profile/ProfileCompletionDialog';
import { SlotSelector } from '@/components/cart/SlotSelector';
import { AddressSelector } from '@/components/cart/AddressSelector';
import { AddFamilyMemberDialog } from '@/components/profile/AddFamilyMemberDialog';


interface Patient {
    id: string;
    name: string;
    relation: string;
}

interface Address {
    id: string;
    line1: string;
    city: string;
    pincode: string;
    lat?: string;
    long?: string;
}

interface AppliedPromo {
    code: string;
    discountAmount: number;
    finalAmount: number;
    promoCodeId: string;
    description?: string;
    discountType: string;
    discountValue: number;
}

interface AvailablePromo {
    id: string;
    code: string;
    description: string | null;
    discountType: 'PERCENTAGE' | 'FLAT';
    discountValue: number;
    maxDiscount: number | null;
    minOrderValue: number;
    expiresAt: string | null;
}

interface SlotItem {
    slot_time: string;
    stm_id: string;
    [key: string]: unknown; // allow extra fields from API
}

export default function CartPage() {
    const { cart, removeFromCart, updateCartItem, loading, refreshCart } = useCart();
    const router = useRouter();
    const [patients, setPatients] = useState<Patient[]>([]);
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [selectedAddressId, setSelectedAddressId] = useState<string>('');

    const [loadingPatients, setLoadingPatients] = useState(true);
    const [loadingAddresses, setLoadingAddresses] = useState(true);

    // Slot states
    const [slots, setSlots] = useState<SlotItem[]>([]);
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [selectedTime, setSelectedTime] = useState<string>('');
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [freezingSlot, setFreezingSlot] = useState(false);

    // Calculate total early for use in functions
    const total = cart?.items.reduce((sum, item) => sum + item.price, 0) || 0;

    // Promo & Wallet State
    const [promoCode, setPromoCode] = useState('');
    const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
    const [walletBalance, setWalletBalance] = useState(0);
    const [useWallet, setUseWallet] = useState(false);
    const [verifyingPromo, setVerifyingPromo] = useState(false);
    const [promoError, setPromoError] = useState('');
    const [availablePromos, setAvailablePromos] = useState<AvailablePromo[]>([]);
    const [showPromoList, setShowPromoList] = useState(false);
    const [loadingPromos, setLoadingPromos] = useState(false);
    const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
    const [addMemberForItemId, setAddMemberForItemId] = useState<string | null>(null);
    const [billingPatientId, setBillingPatientId] = useState<string>('self');

    // Generate next 7 days - MOVED TO SLOT SELECTOR, removed from here

    useEffect(() => {
        fetchPatients();
        fetchAddresses();
        fetchWalletBalance();
        fetchAvailablePromos();
    }, []);

    const fetchWalletBalance = async () => {
        try {
            const res = await api.get('/profile/wallet');
            setWalletBalance(res.data.balance || 0);
        } catch (error) {
            console.error('Error fetching wallet:', error);
        }
    };

    const fetchAvailablePromos = async () => {
        setLoadingPromos(true);
        try {
            const res = await api.get('/promos/available');
            setAvailablePromos(res.data);
        } catch (error) {
            console.error('Error fetching promos:', error);
        } finally {
            setLoadingPromos(false);
        }
    };

    const fetchPatients = async () => {
        try {
            const res = await api.get('/profile/patients');
            setPatients(res.data);
        } catch (error) {
            console.error('Error fetching patients:', error);
        } finally {
            setLoadingPatients(false);
        }
    };

    const fetchAddresses = async () => {
        try {
            const res = await api.get('/profile/addresses');
            setAddresses(res.data);
            if (res.data.length > 0 && !selectedAddressId) {
                setSelectedAddressId(res.data[0].id);
            }
        } catch (error) {
            console.error('Error fetching addresses:', error);
        } finally {
            setLoadingAddresses(false);
        }
    };

    const selectedAddress = addresses.find(addr => addr.id === selectedAddressId);

    useEffect(() => {
        if (selectedAddress) {
            fetchSlots(selectedAddress, selectedDate);
        } else {
            setSlots([]);
            setSelectedTime('');
        }
    }, [selectedAddressId, selectedDate]);

    const fetchSlots = async (address: Address, date: string) => {
        try {
            setLoadingSlots(true);
            setSlots([]); // Clear previous slots while loading

            let finalLat = address.lat;
            let finalLong = address.long;

            // ALWAYS fetch fresh coordinates from pincode to ensure accuracy
            // This is critical for different family member locations
            if (!finalLat || !finalLong) {
                try {
                    const geoRes = await api.get('/location/geocode', { params: { pincode: address.pincode } });
                    if (geoRes.data && geoRes.data.lat) {
                        finalLat = geoRes.data.lat;
                        finalLong = geoRes.data.long;
                        // console.log(`Geocoded ${address.pincode}: lat=${finalLat}, long=${finalLong}`); // Removed console.log
                    }
                } catch (err) {
                    console.error('In-cart geocoding failed:', err);
                    // Fallback to stored coordinates if geocoding fails
                }
            }

            const res = await api.get('/slots', {
                params: {
                    lat: finalLat || '28.6139',
                    long: finalLong || '77.2090',
                    zipcode: address.pincode,
                    date: date // Pass selected date
                }
            });

            // Healthians API might return slots directly or nested in data.slots or just data
            console.log('Slots API Response (Frontend):', res.data);

            let slotsArray: any[] = [];

            // Case 1: res.data.data is an Array (Actual behavior seen in logs)
            if (res.data.data && Array.isArray(res.data.data)) {
                slotsArray = res.data.data;
            }
            // Case 2: res.data.slots is present (Old assumption)
            else if (res.data.slots && Array.isArray(res.data.slots)) {
                slotsArray = res.data.slots;
            }

            if (slotsArray.length > 0) {
                // Filter out invalid slots
                const validSlots = slotsArray.filter((s: SlotItem) => s.slot_time);

                // Deduplicate based on slot_time if needed, but keeping full objects is better
                // For now, we trust the API or just take unique times if we were just displaying
                // But we need the IDs. Let's just set the valid slots.
                setSlots(validSlots);
            } else {
                setSlots([]);
            }
        } catch (error) {
            console.error('Error fetching slots:', error);
            setSlots([]);
        } finally {
            setLoadingSlots(false);
        }
    };

    // handleAddAddress removed - moved to AddressSelector

    const [isSlotLocked, setIsSlotLocked] = useState(false);

    const handleFreezeSlot = async () => {
        if (!selectedAddress || !selectedDate || !selectedTime) return;

        // Find the slot object matching the selected time
        const slot = slots.find(s => s.slot_time === selectedTime);

        if (!slot) {
            console.error('Selected slot not found in current slots list');
            alert('Error: Selected slot data is missing. Please refresh.');
            return;
        }

        // We need 'stm_id' or 'slot_id' from the slot object
        // The logs showed 'stm_id' in the response.
        const slotId = slot.stm_id;

        if (!slotId) {
            console.error('Slot ID (stm_id) missing in slot object:', slot);
            alert('Error: Invalid slot data.');
            return;
        }

        try {
            setFreezingSlot(true);
            console.log('Freezing slot with ID:', slotId);

            const res = await api.post('/slots/freeze', {
                slot_id: slotId
            });

            console.log('Freeze Slot API Response:', res.data);
            alert(`Slot Locked Successfully! Response: ${JSON.stringify(res.data)}`);
            setIsSlotLocked(true);

        } catch (error) {
            console.error('Error freezing slot:', error);
            alert('Failed to lock this slot. Please try another one.');
            setIsSlotLocked(false);
        } finally {
            setFreezingSlot(false);
        }
    };

    const [creatingOrder, setCreatingOrder] = useState(false);
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const [missingProfileFields, setMissingProfileFields] = useState({});

    const applyPromo = async () => {
        if (!promoCode) return;
        setVerifyingPromo(true);
        setPromoError('');
        try {
            const res = await api.post('/promos/validate', {
                code: promoCode,
                cartAmount: total
            });
            setAppliedPromo(res.data);
        } catch (error: any) {
            setAppliedPromo(null);
            setPromoError(error.response?.data?.error || 'Invalid promo code');
        } finally {
            setVerifyingPromo(false);
        }
    };

    const removePromo = () => {
        setAppliedPromo(null);
        setPromoCode('');
        setPromoError('');
        setShowPromoList(false);
    };

    // Calculations
    const discountAmount = appliedPromo ? appliedPromo.discountAmount : 0;
    const payableAfterDiscount = Math.max(0, total - discountAmount);
    const walletDeduction = useWallet ? Math.min(walletBalance, payableAfterDiscount) : 0;
    const finalPayable = Math.max(0, payableAfterDiscount - walletDeduction);

    const handleCheckout = async () => {
        // Validate address selection
        if (!selectedAddressId) {
            alert('Please select a collection address before checkout');
            return;
        }

        // Validate slot selection and lock
        if (!selectedDate || !selectedTime || !isSlotLocked) {
            alert('Please select and lock a collection slot before checkout');
            return;
        }

        // Find slot ID
        const slot = slots.find(s => s.slot_time === selectedTime);
        const slotId = slot?.stm_id;

        if (!slotId) {
            alert('Invalid slot selected. Please refresh the page.');
            return;
        }

        try {
            setCreatingOrder(true);

            // 1. Initiate payment and create Razorpay order
            const initRes = await api.post('/payments/initiate', {
                slot_id: slotId,
                slotLabel: selectedTime,
                slotDate: selectedDate,
                addressId: selectedAddressId,
                promoCode: appliedPromo?.code,
                useWallet,
                billingPatientId: billingPatientId !== 'self' ? billingPatientId : undefined
            });

            const { bookingId, razorpayOrderId, amount, keyId, status } = initRes.data;

            // Check for instant confirmation (Zero Amount)
            if (status === 'confirmed' || amount === 0) {
                alert('Order placed successfully!');
                await refreshCart();
                router.push('/profile?tab=bookings');
                return;
            }

            // 2. Open Razorpay checkout modal
            const options = {
                key: keyId,
                amount: amount,
                currency: 'INR',
                order_id: razorpayOrderId,
                name: 'DOCNOW',
                description: 'Lab Test Booking',
                handler: async (response: any) => {
                    // 3. Verify payment with backend
                    try {
                        setCreatingOrder(true);
                        const verifyRes = await api.post('/payments/verify', {
                            bookingId,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_signature: response.razorpay_signature
                        });

                        if (verifyRes.data.status === 'confirmed' || verifyRes.data.status === 'already_confirmed') {
                            alert('Order placed successfully!');
                            await refreshCart();
                            router.push('/profile?tab=bookings');
                        } else if (verifyRes.data.status === 'payment_received_booking_pending') {
                            // Partner booking failed but payment is secure
                            alert('Payment received! Your booking is being confirmed. You will receive an update shortly.');
                            await refreshCart();
                            router.push('/profile?tab=bookings');
                        } else {
                            alert('Payment verification failed. Please contact support.');
                        }
                    } catch (verifyError: any) {
                        console.error('Payment verification error:', verifyError);
                        alert('Payment verification failed. If amount was deducted, it will be refunded within 5-7 days.');
                    } finally {
                        setCreatingOrder(false);
                    }
                },
                prefill: {
                    contact: '', // Will be filled by Razorpay from user session
                },
                theme: {
                    color: '#4b2192'
                },
                modal: {
                    ondismiss: () => {
                        setCreatingOrder(false);
                        console.log('Razorpay modal closed by user');
                    }
                }
            };

            // Load Razorpay script if not already loaded
            if (!(window as any).Razorpay) {
                await loadRazorpayScript();
            }

            const rzp = new (window as any).Razorpay(options);
            rzp.open();

        } catch (error: any) {
            console.error('Checkout Error:', error);

            // Check for Profile Incomplete Error
            if (error.response?.data?.code === 'PROFILE_INCOMPLETE') {
                setMissingProfileFields(error.response.data.missingFields);
                setProfileDialogOpen(true);
                return;
            }

            alert(error.response?.data?.error || 'Failed to initiate payment. Please try again.');
        } finally {
            setCreatingOrder(false);
        }
    };

    // Helper to load Razorpay script
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




    if (loading || loadingPatients || loadingAddresses) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Header />
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            </div>
        );
    }

    // const availableTimes = slots.find(s => s.slot_date === selectedDate)?.slot_time || []; // This line is no longer needed as slots is already string[]

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            <Header />

            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <h1 className="text-3xl font-bold text-slate-900 mb-8">Your Cart</h1>

                {(!cart || cart.items.length === 0) ? (
                    <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-100">
                        <ShoppingBag className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <p className="text-gray-500 mb-4 text-lg font-medium">Your cart is empty</p>
                        <button
                            onClick={() => router.push('/search')}
                            className="text-primary font-bold hover:underline"
                        >
                            Browse Packages
                        </button>
                    </div>
                ) : (
                    <div className="grid md:grid-cols-3 gap-8">
                        {/* Cart Items & Options */}
                        <div className="md:col-span-2 space-y-6">
                            {/* Items List */}
                            <div className="space-y-4">
                                {cart.items.map((item) => (
                                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                                        <div className="flex items-start gap-4">
                                            <div className="w-16 h-16 bg-primary/10 rounded-lg flex-shrink-0 flex items-center justify-center">
                                                <span className="text-2xl">🧪</span>
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="font-semibold text-slate-900 mb-2 line-clamp-2">{item.testName}</h3>

                                                {/* Patient Assignment */}
                                                <div className="mb-2">
                                                    <label className="text-xs text-gray-500 font-medium mb-1 block">Assign to:</label>
                                                    <select
                                                        value={item.patientId || 'self'}
                                                        onChange={(e) => {
                                                            if (e.target.value === '__add_new__') {
                                                                setAddMemberForItemId(item.id);
                                                                setAddMemberDialogOpen(true);
                                                                e.target.value = item.patientId || 'self';
                                                            } else {
                                                                updateCartItem(item.id, e.target.value === 'self' ? null : e.target.value);
                                                            }
                                                        }}
                                                        className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-full max-w-[220px]"
                                                    >
                                                        <option value="self">Self</option>
                                                        {patients.map((patient) => (
                                                            <option key={patient.id} value={patient.id}>
                                                                {patient.name} ({patient.relation})
                                                            </option>
                                                        ))}
                                                        <option value="__add_new__">➕ Add New Member</option>
                                                    </select>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    {item.mrp && item.mrp > item.price && (
                                                        <span className="text-xs text-gray-400 line-through">₹{item.mrp}</span>
                                                    )}
                                                    <span className="font-bold text-primary text-lg">₹{item.price}</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => removeFromCart(item.id)}
                                                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Address Selection - Extracted */}
                            <AddressSelector
                                addresses={addresses}
                                selectedAddressId={selectedAddressId}
                                onSelect={setSelectedAddressId}
                                onAddressAdded={fetchAddresses}
                            />

                            {/* Slot Selection - Extracted */}
                            {selectedAddressId && (
                                <SlotSelector
                                    slots={slots}
                                    selectedDate={selectedDate}
                                    selectedTime={selectedTime}
                                    loading={loadingSlots}
                                    freezingSlot={freezingSlot}
                                    isSlotLocked={isSlotLocked}
                                    onDateSelect={(date) => {
                                        if (date !== selectedDate) {
                                            setSelectedDate(date);
                                            setSelectedTime('');
                                            setIsSlotLocked(false);
                                        }
                                    }}
                                    onTimeSelect={(time) => {
                                        setSelectedTime(time);
                                        setIsSlotLocked(false);
                                    }}
                                    onFreezeSlot={handleFreezeSlot}
                                />
                            )}

                            {/* Promo Code Section */}
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mt-4">
                                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                    <Ticket className="w-5 h-5 text-gray-500" /> Offers & Benefits
                                </h3>

                                {/* Promo Input + Browser */}
                                {!appliedPromo ? (
                                    <div className="space-y-3">
                                        {/* Input + Apply */}
                                        <div className="flex gap-2">
                                            <div className="flex-1 relative">
                                                <input
                                                    type="text"
                                                    placeholder="Enter Promo Code"
                                                    value={promoCode}
                                                    onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoError(''); }}
                                                    onFocus={() => setShowPromoList(true)}
                                                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] text-sm font-medium uppercase placeholder:normal-case transition-all"
                                                />
                                            </div>
                                            <button
                                                onClick={applyPromo}
                                                disabled={!promoCode || verifyingPromo}
                                                className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                            >
                                                {verifyingPromo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                                            </button>
                                        </div>
                                        {promoError && <p className="text-xs text-red-500 flex items-center gap-1"><X className="w-3 h-3" />{promoError}</p>}

                                        {/* Toggle available promos */}
                                        <button
                                            onClick={() => setShowPromoList(!showPromoList)}
                                            className="w-full flex items-center justify-between text-sm text-[#4b2192] font-medium py-1 hover:underline"
                                        >
                                            <span className="flex items-center gap-1.5">
                                                <Tag className="w-3.5 h-3.5" />
                                                {availablePromos.length > 0 ? `${availablePromos.length} coupon${availablePromos.length > 1 ? 's' : ''} available` : 'View coupons'}
                                            </span>
                                            {showPromoList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </button>

                                        {/* Available Promos List */}
                                        {showPromoList && (
                                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                                                {loadingPromos ? (
                                                    <div className="flex items-center justify-center py-6">
                                                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                                                    </div>
                                                ) : availablePromos.length === 0 ? (
                                                    <div className="text-center py-6 text-sm text-gray-400">
                                                        No coupons available right now
                                                    </div>
                                                ) : (
                                                    availablePromos.map((promo) => {
                                                        const isEligible = total >= promo.minOrderValue;
                                                        return (
                                                            <button
                                                                key={promo.id}
                                                                onClick={() => {
                                                                    setPromoCode(promo.code);
                                                                    setPromoError('');
                                                                    // Auto-apply
                                                                    setShowPromoList(false);
                                                                    setVerifyingPromo(true);
                                                                    api.post('/promos/validate', { code: promo.code, cartAmount: total })
                                                                        .then(res => { setAppliedPromo(res.data); })
                                                                        .catch(err => { setAppliedPromo(null); setPromoError(err.response?.data?.error || 'Invalid promo code'); })
                                                                        .finally(() => setVerifyingPromo(false));
                                                                }}
                                                                disabled={!isEligible}
                                                                className={`w-full text-left p-3 rounded-lg border transition-all ${isEligible
                                                                    ? 'border-gray-200 hover:border-[#4b2192] hover:bg-[#4b2192]/5 cursor-pointer'
                                                                    : 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                                                                    }`}
                                                            >
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div className="flex-1 min-w-0">
                                                                        {/* Code as a dashed coupon style */}
                                                                        <div className="flex items-center gap-2 mb-1">
                                                                            <span className="inline-flex items-center gap-1 text-xs font-bold text-[#4b2192] bg-[#4b2192]/10 px-2 py-0.5 rounded border border-dashed border-[#4b2192]/30 tracking-wider">
                                                                                {promo.code}
                                                                            </span>
                                                                        </div>
                                                                        {promo.description && (
                                                                            <p className="text-xs text-gray-500 mt-1 line-clamp-1">{promo.description}</p>
                                                                        )}
                                                                        {promo.minOrderValue > 0 && (
                                                                            <p className={`text-[10px] mt-1 ${isEligible ? 'text-gray-400' : 'text-orange-500 font-medium'}`}>
                                                                                {isEligible ? `Min. order ₹${promo.minOrderValue}` : `Add ₹${promo.minOrderValue - total} more to unlock`}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                    {/* Discount Badge */}
                                                                    <div className="shrink-0 text-right">
                                                                        <span className="inline-block text-xs font-bold text-green-700 bg-green-50 px-2 py-1 rounded">
                                                                            {promo.discountType === 'PERCENTAGE'
                                                                                ? `${promo.discountValue}% OFF`
                                                                                : `FLAT ₹${promo.discountValue}`}
                                                                        </span>
                                                                        {promo.discountType === 'PERCENTAGE' && promo.maxDiscount && (
                                                                            <p className="text-[10px] text-gray-400 mt-0.5">up to ₹{promo.maxDiscount}</p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="p-3 bg-green-50 border border-green-100 rounded-lg flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
                                                <Check className="w-3.5 h-3.5 text-green-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-green-700">{appliedPromo.code} Applied</p>
                                                <p className="text-xs text-green-600">You saved ₹{appliedPromo.discountAmount}</p>
                                            </div>
                                        </div>
                                        <button onClick={removePromo} className="text-gray-400 hover:text-red-500 transition-colors">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}

                                {/* Wallet Section */}
                                {walletBalance > 0 && (
                                    <div className="mt-4 pt-4 border-t border-gray-100">
                                        <label className="flex items-center gap-3 cursor-pointer select-none">
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useWallet ? 'bg-[#4b2192] border-[#4b2192]' : 'border-gray-300 bg-white'}`}>
                                                {useWallet && <Check className="w-3.5 h-3.5 text-white" />}
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={useWallet}
                                                onChange={(e) => setUseWallet(e.target.checked)}
                                                className="hidden"
                                            />
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                                    <Wallet className="w-4 h-4 text-gray-500" /> Use Wallet Balance
                                                </p>
                                                <p className="text-xs text-gray-500">Available: ₹{walletBalance}</p>
                                            </div>
                                        </label>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Summary / Checkout */}
                        <div className="md:col-span-1">
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 sticky top-24">
                                <h3 className="text-lg font-bold mb-4">Order Summary</h3>

                                <div className="space-y-2 mb-6 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Items ({cart.items.length})</span>
                                        <span className="font-medium">₹{total}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Sample Collection</span>
                                        <span className="text-green-600 font-medium">FREE</span>
                                    </div>
                                    {discountAmount > 0 && (
                                        <div className="flex justify-between text-green-600">
                                            <span>Coupon Discount</span>
                                            <span className="font-medium">- ₹{discountAmount}</span>
                                        </div>
                                    )}
                                    {walletDeduction > 0 && (
                                        <div className="flex justify-between text-[#4b2192]">
                                            <span>Wallet Used</span>
                                            <span className="font-medium">- ₹{walletDeduction}</span>
                                        </div>
                                    )}
                                </div>

                                {selectedAddress && (
                                    <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs space-y-2 border border-gray-100">
                                        <div className="flex items-start gap-2">
                                            <MapPin className="w-3.5 h-3.5 text-primary mt-0.5" />
                                            <div>
                                                <div className="font-bold text-gray-700">Collection at:</div>
                                                <div className="text-gray-500 line-clamp-1">{selectedAddress.line1}</div>
                                                <div className="text-gray-500">{selectedAddress.city} - {selectedAddress.pincode}</div>
                                            </div>
                                        </div>

                                        {selectedDate && selectedTime && (
                                            <div className="flex items-start gap-2 pt-2 border-t border-gray-200">
                                                <Calendar className="w-3.5 h-3.5 text-primary mt-0.5" />
                                                <div>
                                                    <div className="font-bold text-gray-700">Scheduled for:</div>
                                                    <div className="text-gray-500">
                                                        {new Date(selectedDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </div>
                                                    <div className="text-gray-500 font-medium">{selectedTime}</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="border-t border-gray-100 pt-4 mb-4">
                                    <label className="text-xs text-gray-500 font-medium mb-1.5 flex items-center gap-1.5">
                                        <FileText className="w-3.5 h-3.5" /> Invoice Name
                                        <span className="text-gray-400 font-normal">(optional)</span>
                                    </label>
                                    <select
                                        value={billingPatientId}
                                        onChange={(e) => setBillingPatientId(e.target.value)}
                                        className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                                    >
                                        <option value="self">Self</option>
                                        {patients.map((patient) => (
                                            <option key={patient.id} value={patient.id}>
                                                {patient.name} ({patient.relation})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="border-t border-gray-100 pt-4 mb-6">
                                    <div className="flex justify-between text-lg font-bold">
                                        <span>Total</span>
                                        <span>₹{finalPayable}</span>
                                    </div>
                                </div>

                                <button
                                    onClick={handleCheckout}
                                    className="w-full bg-slate-900 text-white rounded-xl py-4 font-bold hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    disabled={!selectedAddressId || !selectedDate || !selectedTime || freezingSlot || creatingOrder || !isSlotLocked}
                                >
                                    {creatingOrder ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Placing Order...
                                        </>
                                    ) : (
                                        "Proceed to Checkout"
                                    )}
                                </button>

                                <div className="mt-4 space-y-1">
                                    {!selectedAddressId && (
                                        <p className="text-[10px] text-red-500 text-center flex items-center justify-center gap-1">
                                            • Address selection required
                                        </p>
                                    )}
                                    {(!selectedDate || !selectedTime) && selectedAddressId && (
                                        <p className="text-[10px] text-orange-500 text-center flex items-center justify-center gap-1">
                                            • Date & time selection required
                                        </p>
                                    )}
                                    {selectedDate && selectedTime && !isSlotLocked && (
                                        <p className="text-[10px] text-red-500 text-center flex items-center justify-center gap-1">
                                            • Please lock the selected slot to proceed
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <ProfileCompletionDialog
                isOpen={profileDialogOpen}
                onClose={() => setProfileDialogOpen(false)}
                onSuccess={() => {
                    setProfileDialogOpen(false);
                    handleCheckout();
                }}
                missingFields={missingProfileFields}
            />

            <AddFamilyMemberDialog
                open={addMemberDialogOpen}
                onOpenChange={setAddMemberDialogOpen}
                onMemberAdded={(newPatient) => {
                    setPatients(prev => [...prev, newPatient]);
                    if (addMemberForItemId) {
                        updateCartItem(addMemberForItemId, newPatient.id);
                    }
                    setAddMemberForItemId(null);
                }}
            />

            {/* ─── Mobile Sticky Checkout Bar ─── */}
            {cart && cart.items.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] p-4 z-40 md:hidden">
                    <div className="flex items-center justify-between max-w-7xl mx-auto">
                        <div>
                            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Total Payable</p>
                            <p className="text-xl font-black text-gray-900">₹{finalPayable}</p>
                        </div>
                        <button
                            onClick={handleCheckout}
                            disabled={!selectedAddressId || !selectedDate || !selectedTime || freezingSlot || creatingOrder || !isSlotLocked}
                            className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {creatingOrder ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Placing...
                                </>
                            ) : (
                                "Checkout"
                            )}
                        </button>
                    </div>
                    {(!selectedAddressId || !selectedDate || !selectedTime || !isSlotLocked) && (
                        <p className="text-[10px] text-orange-500 text-center mt-2">
                            {!selectedAddressId ? "Select an address" : (!selectedDate || !selectedTime) ? "Select date & time" : "Lock the slot"} to proceed
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
