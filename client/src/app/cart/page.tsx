"use client";

import { Loader2, ShoppingBag } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useCart } from '@/contexts/CartContext';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { getCollectionFee } from '@/lib/collectionFee';

// Extracted Components
import { SlotSelector } from '@/components/cart/SlotSelector';
import { AddressSelector } from '@/components/cart/AddressSelector';
import { ProfileCompletionDialog } from '@/components/profile/ProfileCompletionDialog';
import { AddFamilyMemberDialog } from '@/components/profile/AddFamilyMemberDialog';
import { CartItemCard } from '@/components/cart/CartItemCard';
import { PromoSection } from '@/components/cart/PromoSection';
import { OrderSummary } from '@/components/cart/OrderSummary';
import { MobileCheckoutBar } from '@/components/cart/MobileCheckoutBar';

// Custom Hooks & Types
import { useSlots } from '@/hooks/useSlots';
import { usePromo } from '@/hooks/usePromo';
import { useCheckout } from '@/hooks/useCheckout';
import { Patient, Address } from '@/types/cart';

export default function CartPage() {
    const { cart, removeFromCart, updateCartItem, loading, refreshCart } = useCart();
    const router = useRouter();

    // Data Fetching State
    const [patients, setPatients] = useState<Patient[]>([]);
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [selectedAddressId, setSelectedAddressId] = useState<string>('');
    const [loadingPatients, setLoadingPatients] = useState(true);
    const [loadingAddresses, setLoadingAddresses] = useState(true);

    // Dialog state
    const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
    const [addMemberForItemId, setAddMemberForItemId] = useState<string | null>(null);
    const [billingPatientId, setBillingPatientId] = useState<string>('self');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

    const total = cart?.items.reduce((sum, item) => sum + item.price, 0) || 0;

    // Use Custom Hooks
    const selectedAddress = addresses.find(addr => addr.id === selectedAddressId);

    const {
        slots,
        selectedTime,
        setSelectedTime,
        loadingSlots,
        freezingSlot,
        isSlotLocked,
        setIsSlotLocked,
        handleFreezeSlot,
        onTimeSelect,
        secondsRemaining,
        WARNING_AT_SECONDS,
        URGENT_AT_SECONDS
    } = useSlots(selectedAddress, selectedDate);

    const promo = usePromo(total);

    const {
        creatingOrder,
        profileDialogOpen,
        setProfileDialogOpen,
        missingProfileFields,
        availabilityErrors,
        handleCheckout
    } = useCheckout({
        slots,
        selectedTime,
        selectedDate,
        selectedAddressId,
        selectedAddress,
        cartId: cart?.id,
        appliedPromo: promo.appliedPromo,
        useWallet: promo.useWallet,
        billingPatientId,
        isSlotLocked,
        cartItems: cart?.items || [],
        refreshCart
    });

    useEffect(() => {
        fetchInitialData();
    }, []);

    // Fallback: If addresses are available but no valid address is selected, default to the first one.
    useEffect(() => {
        if (addresses.length > 0 && (!selectedAddressId || !addresses.find(a => a.id === selectedAddressId))) {
            setSelectedAddressId(addresses[0].id);
        }
    }, [addresses, selectedAddressId]);

    const fetchInitialData = async () => {
        setLoadingPatients(true);
        setLoadingAddresses(true);
        try {
            const [patientsRes, addressesRes] = await Promise.all([
                api.get('/profile/patients'),
                api.get('/profile/addresses')
            ]);
            setPatients(patientsRes.data);
            setAddresses(addressesRes.data);
            if (addressesRes.data.length > 0) {
                setSelectedAddressId(addressesRes.data[0].id);
            }
        } catch (error) {
            console.error('Error fetching initial cart data:', error);
        } finally {
            setLoadingPatients(false);
            setLoadingAddresses(false);
        }
    };

    const fetchAddresses = async () => {
        try {
            const res = await api.get('/profile/addresses');
            setAddresses(res.data);
        } catch (error) {
            console.error('Error fetching addresses:', error);
        }
    };

    if (loading || loadingPatients || loadingAddresses) {
        return <CartSkeleton />;
    }

    // Calculation shortcuts
    const collectionFee = getCollectionFee(total);
    const discountAmount = promo.appliedPromo ? promo.appliedPromo.discountAmount : 0;
    const payableAfterDiscount = Math.max(0, total + collectionFee - discountAmount);
    const walletDeduction = promo.useWallet ? Math.min(promo.walletBalance, payableAfterDiscount) : 0;
    const finalPayable = Math.max(0, payableAfterDiscount - walletDeduction);

    return (
        <div className="w-full min-h-screen bg-gray-50 pb-32 md:pb-20 overflow-x-hidden">

            <div className="container mx-auto px-3 sm:px-4 py-5 sm:py-8 max-w-4xl">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-5 sm:mb-8">Your Cart</h1>

                {(!cart || cart.items.length === 0) ? (
                    <div className="text-center py-14 sm:py-20 bg-white rounded-xl shadow-sm border border-gray-100">
                        <ShoppingBag className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 text-gray-300" />
                        <p className="text-gray-500 mb-4 text-base sm:text-lg font-medium">Your cart is empty</p>
                        <button
                            onClick={() => router.push('/search')}
                            className="text-primary font-bold hover:underline"
                        >
                            Browse Packages
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-8">
                        <div className="md:col-span-2 space-y-4 sm:space-y-6">
                            <div className="space-y-3 sm:space-y-4">
                                {cart.items.map((item) => (
                                    <CartItemCard
                                        key={item.id}
                                        item={item}
                                        patients={patients}
                                        onRemove={removeFromCart}
                                        onUpdatePatient={updateCartItem}
                                        isUnavailable={availabilityErrors.some(e => e.testCode === item.testCode)}
                                        onAddNewMember={(id) => {
                                            setAddMemberForItemId(id);
                                            setAddMemberDialogOpen(true);
                                        }}
                                    />
                                ))}
                            </div>

                            <AddressSelector
                                addresses={addresses}
                                selectedAddressId={selectedAddressId}
                                onSelect={(id) => {
                                    setSelectedAddressId(id);
                                    setIsSlotLocked(false);
                                }}
                                onAddressAdded={(newId) => {
                                    fetchAddresses();
                                    if (newId) setSelectedAddressId(newId);
                                }}
                            />

                            {selectedAddressId && (
                                <SlotSelector
                                    slots={slots}
                                    selectedDate={selectedDate}
                                    selectedTime={selectedTime}
                                    loading={loadingSlots}
                                    freezingSlot={freezingSlot}
                                    isSlotLocked={isSlotLocked}
                                    secondsRemaining={secondsRemaining}
                                    warningAtSeconds={WARNING_AT_SECONDS}
                                    urgentAtSeconds={URGENT_AT_SECONDS}
                                    onDateSelect={(date) => {
                                        if (date !== selectedDate) {
                                            setSelectedDate(date);
                                            setSelectedTime('');
                                            setIsSlotLocked(false);
                                        }
                                    }}
                                    onTimeSelect={onTimeSelect}
                                    onFreezeSlot={handleFreezeSlot}
                                />
                            )}

                            <PromoSection
                                promoCode={promo.promoCode}
                                setPromoCode={promo.setPromoCode}
                                appliedPromo={promo.appliedPromo}
                                availablePromos={promo.availablePromos}
                                showPromoList={promo.showPromoList}
                                setShowPromoList={promo.setShowPromoList}
                                loadingPromos={promo.loadingPromos}
                                verifyingPromo={promo.verifyingPromo}
                                promoError={promo.promoError}
                                applyPromo={promo.applyPromo}
                                removePromo={promo.removePromo}
                                walletBalance={promo.walletBalance}
                                useWallet={promo.useWallet}
                                setUseWallet={promo.setUseWallet}
                                cartTotal={total}
                            />
                        </div>

                        <div className="md:col-span-1">
                            <OrderSummary
                                cartItemsCount={cart.items.length}
                                total={total}
                                collectionFee={collectionFee}
                                discountAmount={discountAmount}
                                walletDeduction={walletDeduction}
                                finalPayable={finalPayable}
                                selectedAddress={selectedAddress}
                                selectedDate={selectedDate}
                                selectedTime={selectedTime}
                                billingPatientId={billingPatientId}
                                setBillingPatientId={setBillingPatientId}
                                patients={patients}
                                handleCheckout={handleCheckout}
                                selectedAddressId={selectedAddressId}
                                isSlotLocked={isSlotLocked}
                                freezingSlot={freezingSlot}
                                creatingOrder={creatingOrder}
                            />
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

            {cart && cart.items.length > 0 && (
                <MobileCheckoutBar
                    finalPayable={finalPayable}
                    handleCheckout={handleCheckout}
                    selectedAddressId={selectedAddressId}
                    selectedDate={selectedDate}
                    selectedTime={selectedTime}
                    freezingSlot={freezingSlot}
                    creatingOrder={creatingOrder}
                    isSlotLocked={isSlotLocked}
                />
            )}
        </div>
    );
}

function CartSkeleton() {
    return (
        <div className="w-full min-h-screen bg-gray-50 pb-32 md:pb-20 overflow-x-hidden">
            <div className="container mx-auto px-3 sm:px-4 py-5 sm:py-8 max-w-4xl">
                <div className="h-8 sm:h-10 w-48 bg-gray-200 rounded-lg animate-pulse mb-5 sm:mb-8" />
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-8">
                    <div className="md:col-span-2 space-y-4 sm:space-y-6">
                        {/* Cart Items Skeleton */}
                        <div className="space-y-3 sm:space-y-4">
                            {[1, 2].map(i => (
                                <div key={i} className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                    <div className="flex gap-4">
                                        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-100 rounded-xl animate-pulse" />
                                        <div className="flex-1 space-y-3 py-1">
                                            <div className="h-5 w-3/4 bg-gray-200 rounded animate-pulse" />
                                            <div className="h-4 w-1/2 bg-gray-100 rounded animate-pulse" />
                                            <div className="h-4 w-1/4 bg-gray-200 rounded animate-pulse" />
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between">
                                        <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
                                        <div className="h-8 w-24 bg-gray-100 rounded-lg animate-pulse" />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Address Selector Skeleton */}
                        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                            <div className="h-6 w-40 bg-gray-200 rounded animate-pulse mb-4" />
                            <div className="h-20 w-full bg-gray-100 rounded-xl animate-pulse" />
                        </div>

                        {/* Slot Selector Skeleton */}
                        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                            <div className="h-6 w-48 bg-gray-200 rounded animate-pulse mb-4" />
                            <div className="flex gap-3 mb-4">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="h-16 w-20 bg-gray-100 rounded-xl animate-pulse" />
                                ))}
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="h-10 w-full bg-gray-100 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Order Summary Skeleton */}
                    <div className="md:col-span-1">
                        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm sticky top-24">
                            <div className="h-6 w-40 bg-gray-200 rounded animate-pulse mb-6" />
                            
                            <div className="space-y-4 mb-6">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="flex justify-between">
                                        <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                                        <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
                                    </div>
                                ))}
                            </div>
                            
                            <div className="pt-4 border-t border-gray-100 mb-6">
                                <div className="flex justify-between">
                                    <div className="h-5 w-20 bg-gray-200 rounded animate-pulse" />
                                    <div className="h-6 w-24 bg-gray-200 rounded animate-pulse" />
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
