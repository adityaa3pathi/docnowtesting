'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { AdminUser } from '@/types/admin';

interface UseWalletAdjustOptions {
    onSuccess: (userId: string, newBalance: number) => void;
}

export function useWalletAdjust({ onSuccess }: UseWalletAdjustOptions) {
    const [showModal, setShowModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
    const [walletAction, setWalletAction] = useState<'credit' | 'debit'>('credit');
    const [walletAmount, setWalletAmount] = useState('');
    const [walletReason, setWalletReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const openModal = (user: AdminUser) => {
        setSelectedUser(user);
        setWalletAction('credit');
        setWalletAmount('');
        setWalletReason('');
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setWalletAmount('');
        setWalletReason('');
    };

    const handleSubmit = async () => {
        if (!selectedUser || !walletAmount || !walletReason) {
            toast.error('Please fill in all fields');
            return;
        }

        const amount = parseFloat(walletAmount);
        if (isNaN(amount) || amount <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }

        const confirmMsg = `Are you sure you want to ${walletAction.toUpperCase()} ₹${amount} for ${selectedUser.name || selectedUser.mobile}?`;
        if (!confirm(confirmMsg)) return;

        setSubmitting(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch('/api/admin/wallets/adjust', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userId: selectedUser.id,
                    type: walletAction === 'credit' ? 'CREDIT' : 'DEBIT',
                    amount: amount,
                    reason: walletReason,
                }),
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to adjust wallet');
            }

            const result = await res.json();
            toast.success(`Wallet adjusted successfully. New balance: ₹${result.newBalance}`);

            onSuccess(selectedUser.id, result.newBalance);
            closeModal();
        } catch (error: any) {
            console.error('Error adjusting wallet:', error);
            toast.error(error.message || 'Failed to adjust wallet');
        } finally {
            setSubmitting(false);
        }
    };

    return {
        showModal,
        selectedUser,
        walletAction,
        setWalletAction,
        walletAmount,
        setWalletAmount,
        walletReason,
        setWalletReason,
        submitting,
        openModal,
        closeModal,
        handleSubmit
    };
}
