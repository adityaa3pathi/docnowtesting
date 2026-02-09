'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Wallet,
    ArrowUpRight,
    ArrowDownLeft,
    Search,
    Filter,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    Loader2,
} from 'lucide-react';

interface LedgerEntry {
    id: string;
    type: 'CREDIT' | 'DEBIT';
    amount: number;
    balanceAfter: number;
    description: string;
    referenceType: string | null;
    referenceId: string | null;
    createdAt: string;
    user: {
        id: string;
        name: string | null;
        mobile: string;
        email: string | null;
    };
    adminId: string | null;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export default function WalletsPage() {
    const [ledger, setLedger] = useState<LedgerEntry[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState<'All' | 'CREDIT' | 'DEBIT'>('All');
    const [searchTerm, setSearchTerm] = useState('');

    const fetchLedger = useCallback(async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
            });

            if (filterType !== 'All') params.append('type', filterType);
            if (searchTerm) params.append('search', searchTerm);

            const res = await fetch(`/api/admin/wallets/ledger?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) throw new Error('Failed to fetch ledger');

            const data = await res.json();
            setLedger(data.ledger);
            setPagination(data.pagination);
        } catch (error) {
            console.error('Error fetching ledger:', error);
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, filterType, searchTerm]);

    useEffect(() => {
        fetchLedger();
    }, [fetchLedger]);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const formatDateTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">Wallet Management</h1>
                    <p className="text-gray-600 mt-1">System-wide transaction ledger</p>
                </div>
                <button
                    onClick={fetchLedger}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {/* Filters & Search */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Search by user name, mobile, or email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] focus:border-transparent"
                        />
                    </div>
                    <div className="flex gap-2">
                        {(['All', 'CREDIT', 'DEBIT'] as const).map((type) => (
                            <button
                                key={type}
                                onClick={() => {
                                    setFilterType(type);
                                    setPagination(prev => ({ ...prev, page: 1 }));
                                }}
                                className={`px-4 py-2 rounded-lg transition-colors ${filterType === type
                                        ? 'bg-[#4b2192] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Ledger Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
                    </div>
                ) : ledger.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                        <p>No transactions found</p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-100">
                                    <tr>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Balance After</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Reason / Ref</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Admin</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {ledger.map((entry) => (
                                        <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                                                {formatDateTime(entry.createdAt)}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-medium text-gray-900">{entry.user.name || 'Unknown'}</p>
                                                    <p className="text-xs text-gray-500">{entry.user.mobile}</p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${entry.type === 'CREDIT'
                                                            ? 'bg-green-100 text-green-800'
                                                            : 'bg-red-100 text-red-800'
                                                        }`}
                                                >
                                                    {entry.type === 'CREDIT' ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
                                                    {entry.type}
                                                </span>
                                            </td>
                                            <td className={`px-6 py-4 font-medium ${entry.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>
                                                {entry.type === 'CREDIT' ? '+' : '-'}₹{Math.abs(entry.amount).toLocaleString('en-IN')}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-900">
                                                ₹{entry.balanceAfter.toLocaleString('en-IN')}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                <p className="truncate max-w-xs" title={entry.description}>{entry.description}</p>
                                                {entry.referenceId && (
                                                    <p className="text-xs text-gray-400 font-mono mt-0.5">{entry.referenceId}</p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-500">
                                                {entry.adminId ? <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">Admin</span> : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
                            <p className="text-sm text-gray-500">
                                Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
                                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} transactions
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                    disabled={pagination.page <= 1}
                                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <span className="px-3 py-1 text-sm">
                                    Page {pagination.page} of {pagination.totalPages}
                                </span>
                                <button
                                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                    disabled={pagination.page >= pagination.totalPages}
                                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
