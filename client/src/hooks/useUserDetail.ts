'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { UserData } from '@/types/admin';

export function useUserDetail(userId: string) {
    const [data, setData] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const token = localStorage.getItem('docnow_auth_token');
                const res = await fetch(`/api/admin/users/${userId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!res.ok) {
                    if (res.status === 404) {
                        setError('User not found');
                    } else {
                        throw new Error('Failed to fetch user');
                    }
                    return;
                }

                const userData = await res.json();
                setData(userData);
            } catch (err) {
                console.error('Error fetching user:', err);
                setError('Failed to load user data');
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
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch(`/api/admin/users/${userId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ status: newStatus, reason: 'Admin action from user detail page' }),
            });

            if (!res.ok) throw new Error('Failed to update user status');

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
