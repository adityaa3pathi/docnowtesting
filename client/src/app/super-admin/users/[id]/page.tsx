'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Ban, CheckCircle, Loader2 } from 'lucide-react';
import { useUserDetail } from '@/hooks/useUserDetail';
import { UserInfoCards } from '@/components/admin/UserInfoCards';
import { OrderHistory } from '@/components/admin/OrderHistory';
import { WalletLedger } from '@/components/admin/WalletLedger';

export default function UserDetailPage() {
    const params = useParams();
    const userId = params.id as string;

    const {
        data,
        loading,
        error,
        actionLoading,
        expandedOrders,
        handleBlockUnblock,
        toggleOrderExpand
    } = useUserDetail(userId);

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

            {/* Info Cards */}
            <UserInfoCards
                user={user}
                walletBalance={wallet.balance}
                walletTransactionCount={walletLedger.length}
                referralInfo={referralInfo}
            />

            {/* Orders */}
            <OrderHistory
                orders={orders}
                expandedOrders={expandedOrders}
                onToggleExpand={toggleOrderExpand}
            />

            {/* Wallet Ledger */}
            <WalletLedger ledger={walletLedger} />
        </div>
    );
}
