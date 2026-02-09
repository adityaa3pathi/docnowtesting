'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft,
    User,
    Phone,
    Mail,
    Calendar,
    Wallet,
    ShoppingCart,
    Users,
    Ban,
    CheckCircle,
    Loader2,
    ExternalLink,
} from 'lucide-react';

interface UserDetails {
    id: string;
    name: string | null;
    email: string | null;
    mobile: string;
    status: 'ACTIVE' | 'BLOCKED';
    referralCode: string | null;
    createdAt: string;
}

interface WalletLedgerEntry {
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    referenceType: string | null;
    referenceId: string | null;
    createdAt: string;
}

interface Order {
    id: string;
    status: string;
    totalAmount: number;
    slotDate: string | null;
    slotTime: string | null;
    createdAt: string;
    partnerBookingId: string | null;
}

interface ReferralInfo {
    referredBy: { id: string; name: string | null; mobile: string } | null;
    referredCount: number;
}

interface UserData {
    user: UserDetails;
    wallet: { balance: number };
    walletLedger: WalletLedgerEntry[];
    orders: Order[];
    referralInfo: ReferralInfo;
}

export default function UserDetailPage() {
    const router = useRouter();
    const params = useParams();
    const userId = params.id as string;

    const [data, setData] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

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
        } catch (err) {
            console.error('Error updating user status:', err);
            alert('Failed to update user status');
        } finally {
            setActionLoading(false);
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    const formatDateTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="space-y-6">
                <Link href="/super-admin/users" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
                    <ArrowLeft size={20} />
                    Back to Users
                </Link>
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <p className="text-red-700">{error || 'User not found'}</p>
                </div>
            </div>
        );
    }

    const { user, wallet, walletLedger, orders, referralInfo } = data;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/super-admin/users" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900">{user.name || 'No Name'}</h1>
                        <p className="text-gray-600">User ID: {user.id}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span
                        className={`inline-flex px-3 py-1 text-sm font-medium rounded-full ${user.status === 'ACTIVE'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                    >
                        {user.status === 'ACTIVE' ? 'Active' : 'Blocked'}
                    </span>
                    <button
                        onClick={handleBlockUnblock}
                        disabled={actionLoading}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${user.status === 'ACTIVE'
                                ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                : 'bg-green-50 text-green-700 hover:bg-green-100'
                            }`}
                    >
                        {actionLoading ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : user.status === 'ACTIVE' ? (
                            <Ban size={18} />
                        ) : (
                            <CheckCircle size={18} />
                        )}
                        {user.status === 'ACTIVE' ? 'Block User' : 'Unblock User'}
                    </button>
                </div>
            </div>

            {/* User Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Profile Card */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <User size={20} className="text-[#4b2192]" />
                        Profile Information
                    </h3>
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 text-gray-700">
                            <Phone size={16} className="text-gray-400" />
                            <span>{user.mobile}</span>
                        </div>
                        <div className="flex items-center gap-3 text-gray-700">
                            <Mail size={16} className="text-gray-400" />
                            <span>{user.email || 'Not provided'}</span>
                        </div>
                        <div className="flex items-center gap-3 text-gray-700">
                            <Calendar size={16} className="text-gray-400" />
                            <span>Joined {formatDate(user.createdAt)}</span>
                        </div>
                    </div>
                </div>

                {/* Wallet Card */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Wallet size={20} className="text-blue-600" />
                        Wallet Balance
                    </h3>
                    <p className="text-3xl font-bold text-gray-900">
                        ₹{wallet.balance.toLocaleString('en-IN')}
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                        {walletLedger.length} transactions
                    </p>
                </div>

                {/* Referral Card */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Users size={20} className="text-purple-600" />
                        Referral Info
                    </h3>
                    <div className="space-y-3">
                        <div>
                            <p className="text-sm text-gray-500">Referral Code</p>
                            <p className="font-mono text-lg text-[#4b2192]">{user.referralCode || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Referred By</p>
                            <p className="font-medium">
                                {referralInfo.referredBy
                                    ? `${referralInfo.referredBy.name || referralInfo.referredBy.mobile}`
                                    : 'Direct signup'}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Users Referred</p>
                            <p className="text-xl font-semibold">{referralInfo.referredCount}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Orders Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <ShoppingCart size={20} className="text-orange-600" />
                    Recent Orders ({orders.length})
                </h3>
                {orders.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No orders yet</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Booking ID</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Slot</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Amount</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {orders.map((order) => (
                                    <tr key={order.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            <span className="font-mono text-sm">{order.partnerBookingId || order.id.slice(0, 8)}</span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600">{formatDate(order.createdAt)}</td>
                                        <td className="px-4 py-3 text-sm text-gray-600">
                                            {order.slotDate && order.slotTime
                                                ? `${formatDate(order.slotDate)} ${order.slotTime}`
                                                : 'N/A'}
                                        </td>
                                        <td className="px-4 py-3 font-medium">₹{order.totalAmount.toLocaleString('en-IN')}</td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${order.status === 'Report Generated'
                                                        ? 'bg-green-100 text-green-700'
                                                        : order.status === 'Cancelled'
                                                            ? 'bg-red-100 text-red-700'
                                                            : 'bg-yellow-100 text-yellow-700'
                                                    }`}
                                            >
                                                {order.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Wallet Ledger Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Wallet size={20} className="text-blue-600" />
                    Wallet Transactions
                </h3>
                {walletLedger.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No wallet transactions</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Description</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Amount</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Balance</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {walletLedger.map((entry) => (
                                    <tr key={entry.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 text-sm text-gray-600">{formatDateTime(entry.createdAt)}</td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${entry.amount > 0
                                                        ? 'bg-green-100 text-green-700'
                                                        : 'bg-red-100 text-red-700'
                                                    }`}
                                            >
                                                {entry.amount > 0 ? 'Credit' : 'Debit'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600">
                                            {entry.description}
                                            {entry.referenceId && (
                                                <span className="text-xs text-gray-400 ml-2">({entry.referenceId.slice(0, 8)})</span>
                                            )}
                                        </td>
                                        <td className={`px-4 py-3 font-medium ${entry.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {entry.amount > 0 ? '+' : ''}₹{Math.abs(entry.amount).toLocaleString('en-IN')}
                                        </td>
                                        <td className="px-4 py-3 font-medium">₹{entry.balanceAfter.toLocaleString('en-IN')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
