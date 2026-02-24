"use client";

import { Header } from '@/components/Header';
import { Loader2, ShoppingBag } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useCart } from '@/contexts/CartContext';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

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
        onTimeSelect
    } = useSlots(selectedAddress, selectedDate);

    const promo = usePromo(total);

    const {
        creatingOrder,
        profileDialogOpen,
        setProfileDialogOpen,
        missingProfileFields,
        handleCheckout
    } = useCheckout({
        slots,
        selectedTime,
        selectedDate,
        selectedAddressId,
        appliedPromo: promo.appliedPromo,
        useWallet: promo.useWallet,
        billingPatientId,
        isSlotLocked,
        refreshCart
    });

    useEffect(() => {
        fetchInitialData();
    }, []);

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
        return (
            <div className="min-h-screen bg-gray-50">
                <Header />
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            </div>
        );
    }

    // Calculation shortcuts
    const discountAmount = promo.appliedPromo ? promo.appliedPromo.discountAmount : 0;
    const payableAfterDiscount = Math.max(0, total - discountAmount);
    const walletDeduction = promo.useWallet ? Math.min(promo.walletBalance, payableAfterDiscount) : 0;
    const finalPayable = Math.max(0, payableAfterDiscount - walletDeduction);

    return (
        <div className="w-full min-h-screen bg-gray-50 pb-32 md:pb-20 overflow-x-hidden">
            <Header />

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
                                onAddressAdded={fetchAddresses}
                            />

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
