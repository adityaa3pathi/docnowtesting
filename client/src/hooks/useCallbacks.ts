import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';

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
            const token = localStorage.getItem('docnow_auth_token');
            const searchParams = new URLSearchParams({
                page: params.page.toString(),
                limit: '20'
            });

            if (params.search) searchParams.append('search', params.search);
            if (params.status && params.status !== 'All') searchParams.append('status', params.status);
            if (params.createdDate) searchParams.append('createdDate', params.createdDate);

            const res = await fetch(`${apiPrefix}/callbacks?${searchParams.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) throw new Error('Failed to fetch callbacks');

            const data = await res.json();
            setCallbacks(data.callbacks);
            setPagination(data.pagination);
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
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch(`${apiPrefix}/callbacks/${id}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ status: newStatus, notes })
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to update callback status');
            }

            const data = await res.json();
            setCallbacks(prev => prev.map(cb => cb.id === id ? data.callback : cb));
            toast.success(`Callback marked as ${newStatus.toLowerCase()}`);
            return true;
        } catch (error: any) {
            console.error('Error updating callback:', error);
            toast.error(error.message);
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
