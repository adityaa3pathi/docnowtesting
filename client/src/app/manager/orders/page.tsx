'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, RefreshCw, Smartphone, CheckCircle, Banknote } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

interface ManagerOrder {
    id: string;
    bookingId: string;
    status: string;
    collectionMode: string | null;
    totalAmount: number;
    razorpayLinkUrl: string | null;
    confirmedAt: string | null;
    createdAt: string;
    booking: {
        status: string;
        paymentStatus: string;
        partnerBookingId: string | null;
    };
    customer: {
        name: string | null;
        mobile: string;
    };
}

const STATUS_COLORS: Record<string, string> = {
    CREATED: 'bg-gray-100 text-gray-700',
    SENT: 'bg-blue-100 text-blue-700',
    PAYMENT_RECEIVED: 'bg-yellow-100 text-yellow-800',
    PAYMENT_CONFIRMED: 'bg-purple-100 text-purple-700',
    CONFIRMED: 'bg-green-100 text-green-700',
    BOOKING_FAILED: 'bg-red-100 text-red-700',
    REFUNDED: 'bg-orange-100 text-orange-700',
};

export default function OrdersPage() {
    const [orders, setOrders] = useState<ManagerOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [confirmModal, setConfirmModal] = useState<{ orderId: string; type: 'link' | 'offline' } | null>(null);
    const [offlineMode, setOfflineMode] = useState<'OFFLINE_CASH' | 'OFFLINE_UPI'>('OFFLINE_CASH');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params: any = {};
            if (statusFilter !== 'all') params.status = statusFilter;
            const res = await api.get('/manager/orders', { params });
            setOrders(res.data);
        } catch {
            toast.error('Failed to load orders');
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { load(); }, [load]);

    const filtered = orders.filter(o => {
        const term = searchTerm.toLowerCase();
        return (
            o.customer.name?.toLowerCase().includes(term) ||
            o.customer.mobile.includes(term) ||
            o.bookingId.includes(term)
        );
    });

    const generateLink = async (orderId: string) => {
        setActionLoading(orderId);
        try {
            const res = await api.post(`/manager/orders/${orderId}/payment-link`);
            toast.success('Payment link generated!');
            if (res.data.shortUrl) {
                navigator.clipboard.writeText(res.data.shortUrl);
                toast('Link copied to clipboard', { icon: '📋' });
            }
            await load();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed');
        } finally {
            setActionLoading(null);
        }
    };

    const confirmPayment = async (orderId: string, mode: 'OFFLINE_CASH' | 'OFFLINE_UPI') => {
        setActionLoading(orderId);
        try {
            const res = await api.post(`/manager/orders/${orderId}/confirm-payment`, { collectionMode: mode });
            if (res.data.status === 'success') {
                toast.success('Payment confirmed & booking finalized!');
            } else {
                toast('Payment registered. Booking retry will be attempted.', { icon: '⚠️' });
            }
            await load();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Failed to confirm payment');
        } finally {
            setActionLoading(null);
            setConfirmModal(null);
        }
    };

    const stats = {
        total: orders.length,
        pending: orders.filter(o => ['CREATED', 'SENT', 'PAYMENT_RECEIVED'].includes(o.status)).length,
        confirmed: orders.filter(o => o.status === 'CONFIRMED').length,
        revenue: orders
            .filter(o => ['CONFIRMED', 'PAYMENT_CONFIRMED'].includes(o.status))
            .reduce((s, o) => s + o.totalAmount, 0),
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">My Orders</h1>
                    <p className="text-gray-500 mt-1 text-sm">Manage and track your manager-created orders</p>
                </div>
                <button onClick={load}
                    className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Total Orders', value: stats.total, color: 'text-gray-900' },
                    { label: 'Pending Action', value: stats.pending, color: 'text-orange-600' },
                    { label: 'Confirmed', value: stats.confirmed, color: 'text-green-600' },
                    { label: 'Revenue', value: `₹${stats.revenue.toLocaleString()}`, color: 'text-purple-700' },
                ].map(s => (
                    <div key={s.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{s.label}</p>
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="search"
                            placeholder="Search by customer name, mobile or booking ID…"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm w-full sm:w-48"
                    >
                        <option value="all">All Statuses</option>
                        <option value="CREATED">Created</option>
                        <option value="SENT">Link Sent</option>
                        <option value="PAYMENT_RECEIVED">Payment Received</option>
                        <option value="CONFIRMED">Confirmed</option>
                        <option value="BOOKING_FAILED">Booking Failed</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className="px-6 py-4 border-b border-gray-100">
                    <h2 className="font-semibold text-gray-900">Orders ({filtered.length})</h2>
                </div>
                {loading ? (
                    <div className="flex justify-center py-16">
                        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-16 text-gray-400">
                        <p className="text-sm">No orders found.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-500 tracking-wide">
                                    <th className="px-5 py-3">Customer</th>
                                    <th className="px-5 py-3">Amount</th>
                                    <th className="px-5 py-3">Order Status</th>
                                    <th className="px-5 py-3">Partner Booking</th>
                                    <th className="px-5 py-3">Date</th>
                                    <th className="px-5 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(order => (
                                    <tr key={order.id} className="border-b border-gray-50 hover:bg-purple-50/30 transition-colors">
                                        <td className="px-5 py-4">
                                            <p className="font-semibold text-gray-900">{order.customer.name || 'Unnamed'}</p>
                                            <p className="text-xs text-gray-400">{order.customer.mobile}</p>
                                        </td>
                                        <td className="px-5 py-4 font-bold text-purple-800">
                                            ₹{order.totalAmount.toLocaleString()}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                                                {order.status.replace(/_/g, ' ')}
                                            </span>
                                            {order.collectionMode && (
                                                <p className="text-xs text-gray-400 mt-1">{order.collectionMode.replace(/_/g, ' ')}</p>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            {order.booking.partnerBookingId ? (
                                                <span className="text-xs font-mono text-green-700 bg-green-50 px-2 py-0.5 rounded">
                                                    {order.booking.partnerBookingId}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-400">
                                                    {order.booking.paymentStatus}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4 text-xs text-gray-500">
                                            {new Date(order.createdAt).toLocaleDateString('en-IN', {
                                                day: 'numeric', month: 'short', year: 'numeric'
                                            })}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center justify-end gap-2">
                                                {/* Send / Resend payment link */}
                                                {['CREATED', 'SENT'].includes(order.status) && (
                                                    <button
                                                        onClick={() => generateLink(order.id)}
                                                        disabled={actionLoading === order.id}
                                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4b2192] text-white hover:bg-purple-900 disabled:opacity-60 transition-colors"
                                                    >
                                                        {actionLoading === order.id
                                                            ? <Loader2 className="w-3 h-3 animate-spin" />
                                                            : <Smartphone className="w-3 h-3" />}
                                                        {order.status === 'SENT' ? 'Resend' : 'Send'} Link
                                                    </button>
                                                )}
                                                {/* Confirm offline payment */}
                                                {['CREATED', 'SENT', 'PAYMENT_RECEIVED'].includes(order.status) && (
                                                    <button
                                                        onClick={() => setConfirmModal({ orderId: order.id, type: 'offline' })}
                                                        disabled={actionLoading === order.id}
                                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                                                    >
                                                        <Banknote className="w-3 h-3" />
                                                        Record Pay
                                                    </button>
                                                )}
                                                {order.status === 'CONFIRMED' && (
                                                    <span className="flex items-center gap-1 text-xs text-green-600 font-semibold">
                                                        <CheckCircle className="w-3.5 h-3.5" /> Done
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Offline payment confirmation modal */}
            {confirmModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-5">
                        <h3 className="font-bold text-gray-900 text-lg">Record Offline Payment</h3>
                        <div className="flex gap-3">
                            {(['OFFLINE_CASH', 'OFFLINE_UPI'] as const).map(m => (
                                <button key={m} onClick={() => setOfflineMode(m)}
                                    className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors
                                        ${offlineMode === m ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-700 hover:border-emerald-400'}`}>
                                    {m === 'OFFLINE_CASH' ? '💵 Cash' : '📱 UPI'}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setConfirmModal(null)}
                                className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">
                                Cancel
                            </button>
                            <button
                                onClick={() => confirmPayment(confirmModal.orderId, offlineMode)}
                                disabled={!!actionLoading}
                                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-2">
                                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
