import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { AppliedPromo, AvailablePromo } from '@/types/cart';

export function usePromo(cartTotal: number) {
    const [promoCode, setPromoCode] = useState('');
    const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
    const [walletBalance, setWalletBalance] = useState(0);
    const [useWallet, setUseWallet] = useState(false);
    const [verifyingPromo, setVerifyingPromo] = useState(false);
    const [promoError, setPromoError] = useState('');
    const [availablePromos, setAvailablePromos] = useState<AvailablePromo[]>([]);
    const [showPromoList, setShowPromoList] = useState(false);
    const [loadingPromos, setLoadingPromos] = useState(false);

    useEffect(() => {
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

    const applyPromo = async (codeOverride?: string) => {
        const codeToApply = codeOverride || promoCode;
        if (!codeToApply) return;

        setVerifyingPromo(true);
        setPromoError('');
        try {
            const res = await api.post('/promos/validate', {
                code: codeToApply,
                cartAmount: cartTotal
            });
            setAppliedPromo(res.data);
            return res.data;
        } catch (error: any) {
            setAppliedPromo(null);
            setPromoError(error.response?.data?.error || 'Invalid promo code');
            throw error;
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

    return {
        promoCode,
        setPromoCode,
        appliedPromo,
        setAppliedPromo,
        walletBalance,
        useWallet,
        setUseWallet,
        verifyingPromo,
        promoError,
        setPromoError,
        availablePromos,
        showPromoList,
        setShowPromoList,
        loadingPromos,
        applyPromo,
        removePromo
    };
}
