'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    Search,
    Eye,
    Ban,
    CheckCircle,
    Wallet,
    Loader2,
    ChevronLeft,
    ChevronRight,
    RefreshCw,
} from 'lucide-react';

interface User {
    id: string;
    name: string | null;
    email: string | null;
    mobile: string;
    status: 'ACTIVE' | 'BLOCKED';
    referralCode: string | null;
    totalOrders: number;
    walletBalance: number;
    createdAt: string;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export default function UsersPage() {
    const router = useRouter();
    const [users, setUsers] = useState<User[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'All' | 'ACTIVE' | 'BLOCKED'>('All');
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Wallet modal state
    const [showWalletModal, setShowWalletModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [walletAction, setWalletAction] = useState<'credit' | 'debit'>('credit');
    const [walletAmount, setWalletAmount] = useState('');
    const [walletReason, setWalletReason] = useState('');

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
            });

            if (searchTerm) params.append('search', searchTerm);
            if (filterStatus !== 'All') params.append('status', filterStatus);

            const res = await fetch(`/api/admin/users?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) throw new Error('Failed to fetch users');

            const data = await res.json();
            setUsers(data.users);
            setPagination(data.pagination);
        } catch (error) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, searchTerm, filterStatus]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const handleBlockUnblock = async (user: User) => {
        const newStatus = user.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE';
        const confirmMsg = user.status === 'ACTIVE'
            ? `Are you sure you want to block ${user.name || user.mobile}?`
            : `Are you sure you want to unblock ${user.name || user.mobile}?`;

        if (!confirm(confirmMsg)) return;

        setActionLoading(user.id);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch(`/api/admin/users/${user.id}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ status: newStatus, reason: 'Admin action' }),
            });

            if (!res.ok) throw new Error('Failed to update user status');

            // Update local state
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: newStatus } : u));
        } catch (error) {
            console.error('Error updating user status:', error);
            alert('Failed to update user status');
        } finally {
            setActionLoading(null);
        }
    };

    const openWalletModal = (user: User) => {
        setSelectedUser(user);
        setWalletAction('credit');
        setWalletAmount('');
        setWalletReason('');
        setShowWalletModal(true);
    };

    const handleWalletSubmit = async () => {
        if (!selectedUser || !walletAmount || !walletReason) {
            alert('Please fill in all fields');
            return;
        }

        const amount = parseFloat(walletAmount);
        if (isNaN(amount) || amount <= 0) {
            alert('Please enter a valid amount');
            return;
        }

        const confirmMsg = `Are you sure you want to ${walletAction.toUpperCase()} ₹${amount} for ${selectedUser.name || selectedUser.mobile}?`;
        if (!confirm(confirmMsg)) return;

        setActionLoading(selectedUser.id); // Re-use loading state
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch('/api/admin/wallets/adjust', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userId: selectedUser.id,
                    type: walletAction === 'credit' ? 'CREDIT' : 'DEBIT',
                    amount: amount,
                    reason: walletReason,
                }),
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to adjust wallet');
            }

            const result = await res.json();
            alert(`Wallet adjusted successfully. New balance: ₹${result.newBalance}`);

            // Update local state
            setUsers(prev => prev.map(u =>
                u.id === selectedUser.id ? { ...u, walletBalance: result.newBalance } : u
            ));

            setShowWalletModal(false);
            setWalletAmount('');
            setWalletReason('');
        } catch (error: any) {
            console.error('Error adjusting wallet:', error);
            alert(error.message || 'Failed to adjust wallet');
        } finally {
            setActionLoading(null);
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">User Management</h1>
                    <p className="text-gray-600 mt-1">Manage and monitor user accounts</p>
                </div>
                <button
                    onClick={fetchUsers}
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
                            placeholder="Search by name, email, or phone..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] focus:border-transparent"
                        />
                    </div>
                    <div className="flex gap-2">
                        {(['All', 'ACTIVE', 'BLOCKED'] as const).map((status) => (
                            <button
                                key={status}
                                onClick={() => {
                                    setFilterStatus(status);
                                    setPagination(prev => ({ ...prev, page: 1 }));
                                }}
                                className={`px-4 py-2 rounded-lg transition-colors ${filterStatus === status
                                    ? 'bg-[#4b2192] text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                {status === 'All' ? 'All' : status === 'ACTIVE' ? 'Active' : 'Blocked'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Users Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
                    </div>
                ) : users.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                        <p>No users found</p>
                        {searchTerm && <p className="text-sm mt-1">Try adjusting your search</p>}
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-100">
                                    <tr>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Orders</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Wallet</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Referral</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {users.map((user) => (
                                        <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-medium text-gray-900">{user.name || 'N/A'}</p>
                                                    <p className="text-xs text-gray-500">{user.id.slice(0, 8)}...</p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-700">{user.mobile}</td>
                                            <td className="px-6 py-4 text-sm text-gray-700">{user.email || 'N/A'}</td>
                                            <td className="px-6 py-4 text-sm text-gray-700">{user.totalOrders}</td>
                                            <td className="px-6 py-4">
                                                <span className="font-medium text-gray-900">₹{user.walletBalance.toLocaleString('en-IN')}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm font-mono text-purple-600">{user.referralCode || 'N/A'}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span
                                                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${user.status === 'ACTIVE'
                                                        ? 'bg-green-100 text-green-700'
                                                        : 'bg-red-100 text-red-700'
                                                        }`}
                                                >
                                                    {user.status === 'ACTIVE' ? 'Active' : 'Blocked'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => router.push(`/super-admin/users/${user.id}`)}
                                                        className="p-2 text-gray-500 hover:text-[#4b2192] hover:bg-purple-50 rounded-lg transition-colors"
                                                        title="View Details"
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => openWalletModal(user)}
                                                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                        title="Adjust Wallet"
                                                    >
                                                        <Wallet size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleBlockUnblock(user)}
                                                        disabled={actionLoading === user.id}
                                                        className={`p-2 rounded-lg transition-colors ${user.status === 'ACTIVE'
                                                            ? 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                                                            : 'text-gray-500 hover:text-green-600 hover:bg-green-50'
                                                            }`}
                                                        title={user.status === 'ACTIVE' ? 'Block User' : 'Unblock User'}
                                                    >
                                                        {actionLoading === user.id ? (
                                                            <Loader2 size={18} className="animate-spin" />
                                                        ) : user.status === 'ACTIVE' ? (
                                                            <Ban size={18} />
                                                        ) : (
                                                            <CheckCircle size={18} />
                                                        )}
                                                    </button>
                                                </div>
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
                                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} users
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

            {/* Wallet Adjustment Modal */}
            {showWalletModal && selectedUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Adjust Wallet Balance</h2>
                        <p className="text-sm text-gray-600 mb-4">
                            User: <span className="font-medium">{selectedUser.name || selectedUser.mobile}</span>
                            <br />
                            Current Balance: <span className="font-medium">₹{selectedUser.walletBalance.toLocaleString('en-IN')}</span>
                        </p>

                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setWalletAction('credit')}
                                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${walletAction === 'credit'
                                        ? 'bg-green-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                >
                                    Credit (+)
                                </button>
                                <button
                                    onClick={() => setWalletAction('debit')}
                                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${walletAction === 'debit'
                                        ? 'bg-red-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                >
                                    Debit (-)
                                </button>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                                <input
                                    type="number"
                                    value={walletAmount}
                                    onChange={(e) => setWalletAmount(e.target.value)}
                                    placeholder="Enter amount"
                                    min="1"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192]"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                                <textarea
                                    value={walletReason}
                                    onChange={(e) => setWalletReason(e.target.value)}
                                    placeholder="Enter reason for adjustment"
                                    rows={3}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] resize-none"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowWalletModal(false)}
                                className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleWalletSubmit}
                                className="flex-1 py-2 px-4 bg-[#4b2192] text-white rounded-lg hover:bg-[#3d1a78] transition-colors"
                            >
                                Confirm {walletAction === 'credit' ? 'Credit' : 'Debit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
