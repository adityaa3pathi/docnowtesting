'use client';

import { RefreshCw } from 'lucide-react';
import { useUsers } from '@/hooks/useUsers';
import { useWalletAdjust } from '@/hooks/useWalletAdjust';
import { UsersFilters } from '@/components/admin/UsersFilters';
import { UsersTable } from '@/components/admin/UsersTable';
import { UserPagination } from '@/components/admin/UserPagination';
import { WalletModal } from '@/components/admin/WalletModal';

export default function UsersPage() {
    const {
        users,
        pagination,
        loading,
        searchTerm,
        setSearchTerm,
        filterStatus,
        setStatusFilter,
        filterRole,
        setRoleFilter,
        actionLoading,
        fetchUsers,
        handleBlockUnblock,
        handleRoleChange,
        updateUserWallet,
        setPage
    } = useUsers();

    const wallet = useWalletAdjust({
        onSuccess: updateUserWallet
    });

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
            <UsersFilters
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                filterStatus={filterStatus}
                setStatusFilter={setStatusFilter}
                filterRole={filterRole}
                setRoleFilter={setRoleFilter}
            />

            {/* Users Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <UsersTable
                    users={users}
                    loading={loading}
                    searchTerm={searchTerm}
                    actionLoading={actionLoading}
                    onBlockUnblock={handleBlockUnblock}
                    onRoleChange={handleRoleChange}
                    onOpenWallet={wallet.openModal}
                />

                {!loading && users.length > 0 && (
                    <UserPagination
                        pagination={pagination}
                        onPageChange={setPage}
                    />
                )}
            </div>

            {/* Wallet Adjustment Modal */}
            {wallet.showModal && wallet.selectedUser && (
                <WalletModal
                    selectedUser={wallet.selectedUser}
                    walletAction={wallet.walletAction}
                    setWalletAction={wallet.setWalletAction}
                    walletAmount={wallet.walletAmount}
                    setWalletAmount={wallet.setWalletAmount}
                    walletReason={wallet.walletReason}
                    setWalletReason={wallet.setWalletReason}
                    submitting={wallet.submitting}
                    onSubmit={wallet.handleSubmit}
                    onClose={wallet.closeModal}
                />
            )}
        </div>
    );
}
