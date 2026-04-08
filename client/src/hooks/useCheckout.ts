import { useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { SlotItem, AppliedPromo, Address } from '@/types/cart';

interface CheckoutDeps {
    slots: SlotItem[];
    selectedTime: string;
    selectedDate: string;
    selectedAddressId: string;
    selectedAddress: Address | undefined;
    cartId: string | undefined;
    appliedPromo: AppliedPromo | null;
    useWallet: boolean;
    billingPatientId: string;
    isSlotLocked: boolean;
    refreshCart: () => Promise<void>;
}

export function useCheckout({
    slots,
    selectedTime,
    selectedDate,
    selectedAddressId,
    selectedAddress,
    cartId,
    appliedPromo,
    useWallet,
    billingPatientId,
    isSlotLocked,
    refreshCart
}: CheckoutDeps) {
    const router = useRouter();
    const [creatingOrder, setCreatingOrder] = useState(false);
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const [missingProfileFields, setMissingProfileFields] = useState({});
    const [availabilityErrors, setAvailabilityErrors] = useState<Array<{ testCode: string; testName: string }>>([]);

    const handleCheckout = async () => {
        if (!selectedAddressId) {
            toast.error('Please select a collection address before checkout');
            return;
        }

        if (!selectedDate || !selectedTime || !isSlotLocked) {
            toast.error('Please select and lock a collection slot before checkout');
            return;
        }

        const slot = slots.find(s => s.slot_time === selectedTime);
        const slotId = slot?.stm_id;

        if (!slotId) {
            toast.error('Invalid slot selected. Please refresh the page.');
            return;
        }

        try {
            setCreatingOrder(true);

            // ── Pre-checkout: validate test availability at location ────────
            if (cartId && selectedAddress?.pincode) {
                try {
                    const validateRes = await api.post('/payments/validate', {
                        cartId,
                        zipcode: selectedAddress.pincode,
                        lat: selectedAddress.lat,
                        long: selectedAddress.long,
                        date: selectedDate
                    });

                    if (!validateRes.data.valid && validateRes.data.unavailable?.length > 0) {
                        setCreatingOrder(false);
                        for (const item of validateRes.data.unavailable) {
                            toast.error(
                                `"${item.testName}" is not available at your location. Please remove it to proceed.`,
                                { duration: 6000 }
                            );
                        }
                        setAvailabilityErrors(validateRes.data.unavailable);
                        return;
                    }
                    // All items valid — clear any previous errors
                    setAvailabilityErrors([]);
                } catch (validateErr: any) {
                    // If validation itself errors (e.g. Healthians timeout), warn but don't block
                    console.warn('[Checkout] Availability check failed, proceeding anyway:', validateErr?.message);
                }
            }
            // ────────────────────────────────────────────────────────────────

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

            if (status === 'confirmed' || amount === 0) {
                toast.success('Order placed successfully!');
                await refreshCart();
                router.push('/profile?tab=bookings');
                return;
            }

            const options = {
                key: keyId,
                amount: amount,
                currency: 'INR',
                order_id: razorpayOrderId,
                name: 'DOCNOW',
                description: 'Lab Test Booking',
                handler: async (response: any) => {
                    try {
                        setCreatingOrder(true);
                        const verifyRes = await api.post('/payments/verify', {
                            bookingId,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_signature: response.razorpay_signature
                        });

                        if (verifyRes.data.status === 'confirmed' || verifyRes.data.status === 'already_confirmed') {
                            toast.success('Order placed successfully!');
                            await refreshCart();
                            router.push('/profile?tab=bookings');
                        } else if (verifyRes.data.status === 'payment_received_booking_pending') {
                            toast.success('Payment received! Your booking is being confirmed. You will receive an update shortly.');
                            await refreshCart();
                            router.push('/profile?tab=bookings');
                        } else if (verifyRes.data.status === 'refunded_due_to_partner_error') {
                            toast.error('Booking Failed: Partner issue. Payment auto-refund initiated.', {
                                duration: 8000,
                                icon: '❌'
                            });
                            await refreshCart();
                            router.push('/profile?tab=bookings');
                        } else {
                            toast.error('Payment verification failed. Please contact support.');
                        }
                    } catch (verifyError: any) {
                        console.error('Payment verification error:', verifyError);
                        toast.error('Payment verification failed. If amount was deducted, it will be refunded within 5-7 days.');
                    } finally {
                        setCreatingOrder(false);
                    }
                },
                prefill: { contact: '' },
                theme: { color: '#4b2192' },
                modal: {
                    ondismiss: () => {
                        setCreatingOrder(false);
                    }
                }
            };

            if (!(window as any).Razorpay) {
                await loadRazorpayScript();
            }

            const rzp = new (window as any).Razorpay(options);
            rzp.open();

        } catch (error: any) {
            console.error('Checkout Error:', error);
            if (error.response?.data?.code === 'PROFILE_INCOMPLETE') {
                setMissingProfileFields(error.response.data.missingFields);
                setProfileDialogOpen(true);
                return;
            }
            toast.error(error.response?.data?.error || 'Failed to initiate payment. Please try again.');
        } finally {
            setCreatingOrder(false);
        }
    };

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

    return {
        creatingOrder,
        profileDialogOpen,
        setProfileDialogOpen,
        missingProfileFields,
        availabilityErrors,
        handleCheckout
    };
}
