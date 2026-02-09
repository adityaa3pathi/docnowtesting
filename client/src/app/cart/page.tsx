"use client";

import { Header } from '@/components/Header';
import { Trash2, Loader2, ShoppingBag, MapPin, Calendar } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useCart } from '@/contexts/CartContext';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { ProfileCompletionDialog } from '@/components/profile/ProfileCompletionDialog'; // Add import
import { SlotSelector } from '@/components/cart/SlotSelector';
import { AddressSelector } from '@/components/cart/AddressSelector';


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

interface Slot {
    slot_date: string;
    slot_time: string[];
}

export default function CartPage() {
    const { cart, removeFromCart, updateCartItem, loading, refreshCart } = useCart();
    const router = useRouter();
    const [patients, setPatients] = useState<Patient[]>([]);
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [selectedAddressId, setSelectedAddressId] = useState<string>('');
    const [loadingPatients, setLoadingPatients] = useState(true);
    const [loadingAddresses, setLoadingAddresses] = useState(true);
    const [addressDialogOpen, setAddressDialogOpen] = useState(false);
    const [addressForm, setAddressForm] = useState({ line1: '', city: '', pincode: '' });

    // Slot states
    const [slots, setSlots] = useState<any[]>([]); // Changed to any[] to store full slot objects
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [selectedTime, setSelectedTime] = useState<string>('');
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [freezingSlot, setFreezingSlot] = useState(false);

    // Generate next 7 days - MOVED TO SLOT SELECTOR, removed from here

    useEffect(() => {
        fetchPatients();
        fetchAddresses();
    }, []);

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
                const validSlots = slotsArray.filter((s: any) => s.slot_time);

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
                addressId: selectedAddressId
            });

            const { bookingId, razorpayOrderId, amount, keyId } = initRes.data;

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


    const total = cart?.items.reduce((sum, item) => sum + item.price, 0) || 0;

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
                                                <h3 className="font-semibold text-slate-900 mb-2">{item.testName}</h3>

                                                {/* Patient Assignment */}
                                                <div className="mb-2">
                                                    <label className="text-xs text-gray-500 font-medium mb-1 block">Assign to:</label>
                                                    <select
                                                        value={item.patientId || 'self'}
                                                        onChange={(e) => updateCartItem(item.id, e.target.value === 'self' ? null : e.target.value)}
                                                        className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-full max-w-[200px]"
                                                    >
                                                        <option value="self">Self</option>
                                                        {patients.map((patient) => (
                                                            <option key={patient.id} value={patient.id}>
                                                                {patient.name} ({patient.relation})
                                                            </option>
                                                        ))}
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

                                <div className="border-t border-gray-100 pt-4 mb-6">
                                    <div className="flex justify-between text-lg font-bold">
                                        <span>Total</span>
                                        <span>₹{total}</span>
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
        </div>
    );
}
