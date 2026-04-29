'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { UserData } from '@/types/admin';
import api from '@/lib/api';

export function useUserDetail(userId: string) {
    const [data, setData] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const res = await api.get(`/admin/users/${userId}`);
                setData(res.data);
            } catch (err: any) {
                console.error('Error fetching user:', err);
                if (err.response?.status === 404) {
                    setError('User not found');
                } else {
                    setError('Failed to load user data');
                }
            } finally {
                setLoading(false);
            }
        };

        if (userId) fetchUser();
    }, [userId]);

    const handleBlockUnblock = async () => {
        if (!data) return;

        const newStatus = data.user.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE';
        const confirmMsg = data.user.status === 'ACTIVE'
            ? `Are you sure you want to block ${data.user.name || data.user.mobile}?`
            : `Are you sure you want to unblock ${data.user.name || data.user.mobile}?`;

        if (!confirm(confirmMsg)) return;

        setActionLoading(true);
        try {
            await api.put(`/admin/users/${userId}/status`, {
                status: newStatus,
                reason: 'Admin action from user detail page'
            });

            setData(prev => prev ? {
                ...prev,
                user: { ...prev.user, status: newStatus }
            } : null);
            toast.success(`User ${newStatus.toLowerCase()} successfully`);
        } catch (err) {
            console.error('Error updating user status:', err);
            toast.error('Failed to update user status');
        } finally {
            setActionLoading(false);
        }
    };

    const toggleOrderExpand = (orderId: string) => {
        setExpandedOrders(prev => {
            const next = new Set(prev);
            if (next.has(orderId)) {
                next.delete(orderId);
            } else {
                next.add(orderId);
            }
            return next;
        });
    };

    return {
        data,
        loading,
        error,
        actionLoading,
        expandedOrders,
        handleBlockUnblock,
        toggleOrderExpand
    };
}
