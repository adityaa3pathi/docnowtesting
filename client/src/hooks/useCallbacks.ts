import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

export interface CallbackRequest {
    id: string;
    name: string;
    mobile: string;
    city: string;
    status: 'PENDING' | 'RESOLVED';
    notes: string | null;
    createdAt: string;
}

export interface CallbackPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export function useCallbacks(apiPrefix: '/api/admin' | '/api/manager' = '/api/manager') {
    const [callbacks, setCallbacks] = useState<CallbackRequest[]>([]);
    const [pagination, setPagination] = useState<CallbackPagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const fetchCallbacks = useCallback(async (params: { page: number; search?: string; status?: string; createdDate?: string }) => {
        setLoading(true);
        try {
            const searchParams = new URLSearchParams({
                page: params.page.toString(),
                limit: '20'
            });

            if (params.search) searchParams.append('search', params.search);
            if (params.status && params.status !== 'All') searchParams.append('status', params.status);
            if (params.createdDate) searchParams.append('createdDate', params.createdDate);

            const prefix = apiPrefix.replace('/api', '');
            const res = await api.get(`${prefix}/callbacks?${searchParams.toString()}`);

            setCallbacks(res.data.callbacks);
            setPagination(res.data.pagination);
        } catch (error: any) {
            console.error('Error fetching callbacks:', error);
            toast.error(error.message || 'Failed to fetch callbacks');
        } finally {
            setLoading(false);
        }
    }, [apiPrefix]);

    const updateStatus = async (id: string, newStatus: 'PENDING' | 'RESOLVED', notes?: string) => {
        setActionLoading(id);
        try {
            const prefix = apiPrefix.replace('/api', '');
            const res = await api.put(`${prefix}/callbacks/${id}/status`, { status: newStatus, notes });

            setCallbacks(prev => prev.map(cb => cb.id === id ? res.data.callback : cb));
            toast.success(`Callback marked as ${newStatus.toLowerCase()}`);
            return true;
        } catch (error: any) {
            console.error('Error updating callback:', error);
            toast.error(error.response?.data?.error || error.message || 'Failed to update callback status');
            return false;
        } finally {
            setActionLoading(null);
        }
    };

    return {
        callbacks,
        pagination,
        loading,
        actionLoading,
        fetchCallbacks,
        updateStatus
    };
}
