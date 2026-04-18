import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';

export type CorporateInquiryStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CLOSED';

export interface CorporateInquiry {
    id: string;
    contactName: string;
    workEmail: string;
    mobile: string;
    companyName: string;
    city: string;
    companySize: string;
    requirementType: string;
    summary: string | null;
    status: CorporateInquiryStatus;
    notes: string | null;
    createdAt: string;
}

export interface CorporateInquiryPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export function useCorporateInquiries(apiPrefix: '/api/admin' | '/api/manager' = '/api/manager') {
    const [inquiries, setInquiries] = useState<CorporateInquiry[]>([]);
    const [pagination, setPagination] = useState<CorporateInquiryPagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const fetchInquiries = useCallback(async (params: { page: number; search?: string; status?: string; city?: string; requirementType?: string; companySize?: string; createdDate?: string }) => {
        setLoading(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const searchParams = new URLSearchParams({
                page: params.page.toString(),
                limit: '20',
            });

            if (params.search) searchParams.append('search', params.search);
            if (params.status && params.status !== 'All') searchParams.append('status', params.status);
            if (params.city) searchParams.append('city', params.city);
            if (params.requirementType && params.requirementType !== 'All') searchParams.append('requirementType', params.requirementType);
            if (params.companySize && params.companySize !== 'All') searchParams.append('companySize', params.companySize);
            if (params.createdDate) searchParams.append('createdDate', params.createdDate);

            const res = await fetch(`${apiPrefix}/corporate-inquiries?${searchParams.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) throw new Error('Failed to fetch corporate inquiries');

            const data = await res.json();
            setInquiries(data.inquiries);
            setPagination(data.pagination);
        } catch (error: any) {
            console.error('Error fetching corporate inquiries:', error);
            toast.error(error.message || 'Failed to fetch corporate inquiries');
        } finally {
            setLoading(false);
        }
    }, [apiPrefix]);

    const updateStatus = async (id: string, newStatus: CorporateInquiryStatus, notes?: string) => {
        setActionLoading(id);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch(`${apiPrefix}/corporate-inquiries/${id}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ status: newStatus, notes }),
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to update corporate inquiry');
            }

            const data = await res.json();
            setInquiries((prev) => prev.map((item) => item.id === id ? data.inquiry : item));
            toast.success(`Inquiry marked as ${newStatus.toLowerCase()}`);
            return true;
        } catch (error: any) {
            console.error('Error updating corporate inquiry:', error);
            toast.error(error.message || 'Failed to update corporate inquiry');
            return false;
        } finally {
            setActionLoading(null);
        }
    };

    return {
        inquiries,
        pagination,
        loading,
        actionLoading,
        fetchInquiries,
        updateStatus,
    };
}
