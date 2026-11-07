import { useRef, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { SlotItem, AppliedPromo, Address } from '@/types/cart';

export interface CartItemBase {
    testCode: string;
    testName: string;
    patientId?: string | null;
}

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
    cartItems: CartItemBase[];
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
    cartItems,
    refreshCart
}: CheckoutDeps) {
    const router = useRouter();
    const [creatingOrder, setCreatingOrder] = useState(false);
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const [missingProfileFields, setMissingProfileFields] = useState({});
    const [availabilityErrors, setAvailabilityErrors] = useState<Array<{ testCode: string; testName: string }>>([]);
    // True from the click until Razorpay closes: a second tap must not start a second order.
    const busy = useRef(false);
    const done = () => {
        busy.current = false;
        setCreatingOrder(false);
    };

    const handleCheckout = async () => {
        if (busy.current) return;
        if (!selectedAddressId) {
            toast.error('Please select a collection address before checkout');
            return;
        }

        if (!selectedDate || !selectedTime || !isSlotLocked) {
            toast.error('Please select and lock a collection slot before checkout');
            return;
        }

        if (cartItems && cartItems.length > 0) {
            const duplicates = cartItems.filter((item, index, self) =>
                self.findIndex(t => t.testCode === item.testCode && (t.patientId || 'self') === (item.patientId || 'self')) !== index
            );

            if (duplicates.length > 0) {
                toast.error(`"${duplicates[0].testName}" is assigned multiple times to the same person. Please assign it to different members or remove the duplicates.`, { duration: 6000 });
                return;
            }
        }

        const slot = slots.find(s => s.slot_time === selectedTime);
        const slotId = slot?.stm_id;

        if (!slotId) {
            toast.error('Invalid slot selected. Please refresh the page.');
            return;
        }

        let modalOpen = false;
        try {
            busy.current = true;
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
                slotDate: slot.slot_date || selectedDate,
                addressId: selectedAddressId,
                promoCode: appliedPromo?.code,
                useWallet,
                billingPatientId: billingPatientId !== 'self' ? billingPatientId : undefined
            });

            const { bookingId, razorpayOrderId, amount, keyId, status } = initRes.data;

            if (status === 'confirmed' || amount === 0) {
                toast.success('Order placed successfully!');
                await refreshCart();
                router.push(`/thank-you?bookingId=${bookingId}`);
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

                        const verified = verifyRes.data.status;
                        if (verified === 'confirmed' || verified === 'already_confirmed') {
                            toast.success('Order placed successfully!');
                            await refreshCart();
                            router.push(`/thank-you?bookingId=${bookingId}`);
                        } else if (verified === 'refunded_due_to_partner_error') {
                            toast.error('We could not book this test with the lab, so your payment is being refunded.', { duration: 8000 });
                            await refreshCart();
                            router.push(`/thank-you?bookingId=${bookingId}`);
                        } else {
                            // Payment received but the booking is still being confirmed.
                            await refreshCart();
                            router.push(`/thank-you?bookingId=${bookingId}&status=pending`);
                        }
                    } catch (verifyError: any) {
                        // A failed verify says nothing about the payment; the next page reads the real outcome.
                        console.error('Payment verification error:', verifyError);
                        router.push(`/thank-you?bookingId=${bookingId}&status=pending`);
                    } finally {
                        done();
                    }
                },
                prefill: { contact: '' },
                theme: { color: '#4b2192' },
                modal: {
                    ondismiss: done
                }
            };

            if (!(window as any).Razorpay) {
                await loadRazorpayScript();
            }

            const rzp = new (window as any).Razorpay(options);
            // Without this a declined card looks exactly like closing the popup. Razorpay keeps
            // the popup open so the customer can retry with another method.
            rzp.on('payment.failed', (resp: any) => {
                toast.error(`Payment failed: ${resp?.error?.description || 'please try another method'}.`, { duration: 6000 });
            });
            rzp.open();
            modalOpen = true;

        } catch (error: any) {
            console.error('Checkout Error:', error);
            if (error.response?.data?.code === 'PROFILE_INCOMPLETE') {
                setMissingProfileFields(error.response.data.missingFields);
                setProfileDialogOpen(true);
                return;
            }
            toast.error(error.response?.data?.error || 'Failed to initiate payment. Please try again.');
        } finally {
            if (!modalOpen) done();
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
