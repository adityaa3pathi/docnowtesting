'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Search,
    Eye,
    Calendar,
    User,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Download,
    AlertTriangle
} from 'lucide-react';
import { useExport } from '@/hooks/useExport';
import { Button } from '@/components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';

interface FailedOrder {
    id: string;
    partnerBookingId: string | null;
    date: string;
    amount: number;
    status: string;
    paymentStatus: string;
    user: {
        id: string;
        name: string | null;
        mobile: string;
        email: string | null;
    };
    patient: {
        name: string;
        relation: string;
        gender: string;
        age: number;
    } | null;
    testNames: string[];
    partnerError: string | null;
    retryLastError: string | null;
    retryAttempts: number;
    nextRetryAt: string | null;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export default function FailedOrdersPage() {
    const [orders, setOrders] = useState<FailedOrder[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // View Details Modal State
    const [selectedOrder, setSelectedOrder] = useState<FailedOrder | null>(null);
    const [showModal, setShowModal] = useState(false);

    const { exporting, exportCsv } = useExport();

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
            });

            if (searchTerm) params.append('search', searchTerm);
            if (dateFrom) params.append('dateFrom', dateFrom);
            if (dateTo) params.append('dateTo', dateTo);

            const res = await api.get(`/admin/failed-orders?${params}`);
            setOrders(res.data.orders);
            setPagination(res.data.pagination);
        } catch (error) {
            console.error('Error fetching failed orders:', error);
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, searchTerm, dateFrom, dateTo]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, dateFrom, dateTo]);

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusColor = (status: string) => {
        const s = status.toLowerCase();
        if (s.includes('refund')) return 'bg-purple-100 text-purple-700';
        if (s.includes('cancel')) return 'bg-red-100 text-red-700';
        if (s.includes('fail')) return 'bg-orange-100 text-orange-700';
        return 'bg-gray-100 text-gray-700';
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900 flex items-center gap-3">
                        <AlertTriangle className="text-red-500" size={32} />
                        Failed Orders
                    </h1>
                    <p className="text-gray-600 mt-1">Track and analyze bookings that failed to process or confirm</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => exportCsv('failed-orders', { search: searchTerm, dateFrom, dateTo })}
                        disabled={exporting}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                        {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                        Export CSV
                    </button>
                    <button
                        onClick={fetchOrders}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex flex-col md:flex-row gap-4 md:flex-wrap">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Search by Order ID, User, or Patient Name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] focus:border-transparent"
                        />
                    </div>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        aria-label="Filter from date"
                    />
                    <input
                        type="date"
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        aria-label="Filter to date"
                    />
                </div>
            </div>

            {/* Orders Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
                    </div>
                ) : orders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                        <p>No failed orders found</p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1200px]">
                                <thead className="bg-gray-50 border-b border-gray-100">
                                    <tr>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Order ID</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider max-w-xs">Failure Reason</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {orders.map((order) => (
                                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4">
                                                <span className="font-mono text-sm font-medium text-gray-900">
                                                    {order.partnerBookingId || order.id.slice(0, 8)}
                                                </span>
                                                {order.partnerBookingId && (
                                                    <p className="text-xs text-gray-400 mt-0.5">{order.id.slice(0, 8)}...</p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                <div className="flex items-center gap-1.5">
                                                    <Calendar size={14} className="text-gray-400" />
                                                    {formatDate(order.date)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-medium text-gray-900 flex items-center gap-1.5">
                                                        <User size={14} className="text-gray-400" />
                                                        {order.user.name || order.user.mobile}
                                                    </p>
                                                    <p className="text-xs text-gray-500 mt-0.5 ml-5">{order.user.mobile}</p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="font-medium text-gray-900">₹{order.amount.toLocaleString('en-IN')}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                                                    {order.status}
                                                </span>
                                                <p className={`text-xs mt-1 px-1.5 inline-block rounded font-medium ${getStatusColor(order.paymentStatus)}`}>
                                                    {order.paymentStatus}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4 max-w-xs">
                                                <div className="text-sm text-red-600 line-clamp-2" title={order.partnerError || order.retryLastError || 'Unknown'}>
                                                    {order.partnerError || order.retryLastError || 'Unknown Failure'}
                                                </div>
                                                {order.retryAttempts > 0 && (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Retries: {order.retryAttempts}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <button
                                                    onClick={() => { setSelectedOrder(order); setShowModal(true); }}
                                                    className="p-2 text-gray-500 hover:text-[#4b2192] hover:bg-purple-50 rounded-lg transition-colors"
                                                    title="View Details"
                                                >
                                                    <Eye size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-gray-100">
                            <p className="text-xs sm:text-sm text-gray-500 text-center sm:text-left">
                                Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
                                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} orders
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

            {/* Order Details Modal */}
            {showModal && selectedOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-6 border-b border-gray-100">
                            <h2 className="text-xl font-semibold text-gray-900">Failed Order Details</h2>
                            <button
                                onClick={() => setShowModal(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            <div className="bg-red-50 border border-red-100 p-4 rounded-lg">
                                <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2 mb-2">
                                    <AlertTriangle size={16} /> Failure Information
                                </h3>
                                <p className="text-sm text-red-700 break-words font-mono mt-1">
                                    {selectedOrder.partnerError || selectedOrder.retryLastError || 'No error message recorded.'}
                                </p>
                                {selectedOrder.retryAttempts > 0 && (
                                    <div className="mt-3 text-xs text-red-600">
                                        <p>Failed Retry Attempts: {selectedOrder.retryAttempts}</p>
                                        {selectedOrder.nextRetryAt && (
                                            <p>Next Retry Scheduled: {formatDate(selectedOrder.nextRetryAt)}</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Order ID</p>
                                    <p className="font-mono font-medium text-base sm:text-lg break-all">{selectedOrder.partnerBookingId || selectedOrder.id}</p>
                                </div>
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Status</p>
                                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(selectedOrder.status)}`}>
                                        {selectedOrder.status}
                                    </span>
                                    <p className={`text-xs mt-2 px-1.5 py-0.5 inline-block rounded font-medium ${getStatusColor(selectedOrder.paymentStatus)}`}>
                                        Payment: {selectedOrder.paymentStatus}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
                                        <User size={16} /> User Details
                                    </h3>
                                    <div className="space-y-1 text-sm text-gray-600">
                                        <p><span className="text-gray-400 w-16 inline-block">Name:</span> {selectedOrder.user.name || '-'}</p>
                                        <p><span className="text-gray-400 w-16 inline-block">Mobile:</span> {selectedOrder.user.mobile}</p>
                                        <p><span className="text-gray-400 w-16 inline-block">Email:</span> {selectedOrder.user.email || '-'}</p>
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
                                        <User size={16} /> Patient Details
                                    </h3>
                                    <div className="space-y-1 text-sm text-gray-600">
                                        <p><span className="text-gray-400 w-16 inline-block">Name:</span> {selectedOrder.patient?.name || '-'}</p>
                                        <p><span className="text-gray-400 w-16 inline-block">Relation:</span> {selectedOrder.patient?.relation || '-'}</p>
                                        <p><span className="text-gray-400 w-16 inline-block">Age/Sex:</span> {selectedOrder.patient?.age} / {selectedOrder.patient?.gender}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-4 border-t border-gray-100">
                                <div className="flex items-center gap-4 sm:gap-6 text-sm text-gray-600">
                                    <div className="flex items-center gap-2">
                                        <Calendar size={16} />
                                        {formatDate(selectedOrder.date)}
                                    </div>
                                </div>
                                <div className="sm:text-right">
                                    <p className="text-sm text-gray-500">Total Amount</p>
                                    <p className="text-2xl font-bold text-[#4b2192]">₹{selectedOrder.amount.toLocaleString('en-IN')}</p>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
