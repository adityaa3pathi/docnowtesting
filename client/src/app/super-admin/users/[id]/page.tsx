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
    ChevronDown,
    ChevronRight,
    FileText,
    ExternalLink,
    TestTube,
    UserCheck,
    MapPin,
    CreditCard,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Patient {
    id: string;
    name: string;
    relation: string;
    age: number;
    gender: string;
}

interface BookingItem {
    id: string;
    testCode: string;
    testName: string;
    price: number;
    status: string | null;
    patient: Patient;
}

interface Report {
    id: string;
    reportUrl: string;
    generatedAt: string;
}

interface Address {
    id: string;
    line1: string;
    city: string;
    pincode: string;
}

interface UserDetails {
    id: string;
    name: string | null;
    email: string | null;
    mobile: string;
    role: string;
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
    finalAmount: number;
    discountAmount: number;
    walletAmount: number;
    paymentStatus: string;
    slotDate: string | null;
    slotTime: string | null;
    createdAt: string;
    partnerBookingId: string | null;
    items: BookingItem[];
    reports: Report[];
    address: Address | null;
    billingName: string | null;
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

    const getStatusColor = (status: string) => {
        const s = status.toLowerCase();
        if (s.includes('report') || s.includes('completed') || s.includes('confirmed')) return 'bg-green-100 text-green-700';
        if (s.includes('cancel')) return 'bg-red-100 text-red-700';
        if (s.includes('fail') || s.includes('error')) return 'bg-red-100 text-red-700';
        return 'bg-yellow-100 text-yellow-700';
    };

    const getPaymentStatusColor = (status: string) => {
        if (status === 'PAID') return 'bg-green-100 text-green-700';
        if (status === 'FAILED' || status === 'REFUNDED') return 'bg-red-100 text-red-700';
        return 'bg-orange-100 text-orange-700';
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
            <div className="space-y-6 p-6">
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
        <div className="space-y-6 p-6 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/super-admin/users" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900">{user.name || 'No Name'}</h1>
                        <p className="text-gray-500 text-sm">User ID: {user.id}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {user.role !== 'USER' && (
                        <span className="inline-flex px-3 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                            {user.role}
                        </span>
                    )}
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
                    Order History ({orders.length})
                </h3>
                {orders.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No orders yet</p>
                ) : (
                    <div className="space-y-3">
                        {orders.map((order) => {
                            const isExpanded = expandedOrders.has(order.id);
                            return (
                                <div key={order.id} className="border border-gray-100 rounded-xl overflow-hidden">
                                    {/* Order Summary Row — clickable */}
                                    <button
                                        onClick={() => toggleOrderExpand(order.id)}
                                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50/80 transition-colors text-left"
                                    >
                                        <div className="text-gray-400">
                                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                        </div>
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
                                            <div>
                                                <p className="text-xs text-gray-400 uppercase font-medium">Booking ID</p>
                                                <p className="font-mono text-sm font-medium text-gray-900">
                                                    {order.partnerBookingId || order.id.slice(0, 8)}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-400 uppercase font-medium">Date</p>
                                                <p className="text-sm text-gray-700">{formatDate(order.createdAt)}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-400 uppercase font-medium">Amount</p>
                                                <p className="text-sm font-semibold text-gray-900">₹{order.totalAmount.toLocaleString('en-IN')}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-400 uppercase font-medium">Payment</p>
                                                <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getPaymentStatusColor(order.paymentStatus)}`}>
                                                    {order.paymentStatus}
                                                </span>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-400 uppercase font-medium">Status</p>
                                                <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(order.status)}`}>
                                                    {order.status}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {order.reports.length > 0 && (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">
                                                    <FileText size={12} />
                                                    {order.reports.length} Report{order.reports.length > 1 ? 's' : ''}
                                                </span>
                                            )}
                                            <span className="text-xs text-gray-400">
                                                {order.items.length} test{order.items.length !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    </button>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-4 space-y-4">
                                            {/* Price Breakdown */}
                                            {(order.discountAmount > 0 || order.walletAmount > 0) && (
                                                <div className="flex flex-wrap gap-4 text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <CreditCard size={14} className="text-gray-400" />
                                                        <span className="text-gray-500">Total:</span>
                                                        <span className="font-medium">₹{order.totalAmount.toLocaleString('en-IN')}</span>
                                                    </div>
                                                    {order.discountAmount > 0 && (
                                                        <div className="flex items-center gap-1">
                                                            <span className="text-green-600">-₹{order.discountAmount.toLocaleString('en-IN')} promo</span>
                                                        </div>
                                                    )}
                                                    {order.walletAmount > 0 && (
                                                        <div className="flex items-center gap-1">
                                                            <span className="text-blue-600">-₹{order.walletAmount.toLocaleString('en-IN')} wallet</span>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-gray-500">Paid:</span>
                                                        <span className="font-semibold text-gray-900">₹{order.finalAmount.toLocaleString('en-IN')}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Billing Name */}
                                            {order.billingName && (
                                                <div className="flex items-center gap-2 text-sm">
                                                    <span className="text-gray-500">Invoice to:</span>
                                                    <span className="font-medium text-gray-800">{order.billingName}</span>
                                                </div>
                                            )}

                                            {/* Slot & Address */}
                                            <div className="flex flex-wrap gap-6 text-sm">
                                                {order.slotDate && order.slotTime && (
                                                    <div className="flex items-center gap-2 text-gray-600">
                                                        <Calendar size={14} className="text-gray-400" />
                                                        <span>Slot: {order.slotDate} at {order.slotTime}</span>
                                                    </div>
                                                )}
                                                {order.address && (
                                                    <div className="flex items-center gap-2 text-gray-600">
                                                        <MapPin size={14} className="text-gray-400" />
                                                        <span>{order.address.line1}, {order.address.city} - {order.address.pincode}</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Test Items Table */}
                                            <div>
                                                <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                                    <TestTube size={14} className="text-purple-600" />
                                                    Tests & Patients
                                                </h4>
                                                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-gray-50">
                                                            <tr>
                                                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Test Name</th>
                                                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Patient</th>
                                                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Relation</th>
                                                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Price</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {order.items.map((item) => (
                                                                <tr key={item.id} className="hover:bg-gray-50">
                                                                    <td className="px-4 py-3">
                                                                        <div className="font-medium text-gray-900">{item.testName}</div>
                                                                        <div className="text-xs text-gray-400 font-mono">{item.testCode}</div>
                                                                    </td>
                                                                    <td className="px-4 py-3">
                                                                        <div className="flex items-center gap-2">
                                                                            <UserCheck size={14} className="text-teal-500" />
                                                                            <div>
                                                                                <span className="font-medium text-gray-800">{item.patient.name}</span>
                                                                                <span className="text-xs text-gray-400 ml-2">
                                                                                    {item.patient.age}y, {item.patient.gender}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-4 py-3">
                                                                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-teal-50 text-teal-700">
                                                                            {item.patient.relation}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 py-3 font-medium text-gray-900">
                                                                        ₹{item.price.toLocaleString('en-IN')}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>

                                            {/* Reports */}
                                            {order.reports.length > 0 && (
                                                <div>
                                                    <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                                        <FileText size={14} className="text-blue-600" />
                                                        Reports
                                                    </h4>
                                                    <div className="flex flex-wrap gap-2">
                                                        {order.reports.map((report, idx) => (
                                                            <a
                                                                key={report.id}
                                                                href={report.reportUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors"
                                                            >
                                                                <FileText size={16} />
                                                                Report {idx + 1}
                                                                <ExternalLink size={14} />
                                                            </a>
                                                        ))}
                                                    </div>
                                                    <p className="text-xs text-gray-400 mt-1">
                                                        Generated on {formatDateTime(order.reports[0].generatedAt)}
                                                    </p>
                                                </div>
                                            )}

                                            {order.items.length === 0 && (
                                                <p className="text-sm text-gray-400 italic">No test items recorded for this order</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
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
