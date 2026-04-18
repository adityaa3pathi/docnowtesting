'use client';

import { RefreshCw, Download } from 'lucide-react';
import { useUsers } from '@/hooks/useUsers';
import { useExport } from '@/hooks/useExport';
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
        createdDate,
        setCreatedDate,
        actionLoading,
        fetchUsers,
        handleBlockUnblock,
        handleRoleChange,
        updateUserWallet,
        setPage
    } = useUsers();

    const { exporting, exportCsv } = useExport();

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
                <div className="flex gap-2">
                    <button
                        onClick={() => exportCsv('users', { search: searchTerm, status: filterStatus, role: filterRole, createdDate })}
                        disabled={exporting}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                        {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                        Export CSV
                    </button>
                    <button
                        onClick={fetchUsers}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-[#4b2192] text-white border border-transparent rounded-lg hover:bg-[#3d1a75] transition-colors"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Filters & Search */}
            <UsersFilters
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                filterStatus={filterStatus}
                setStatusFilter={setStatusFilter}
                filterRole={filterRole}
                setRoleFilter={setRoleFilter}
                createdDate={createdDate}
                setCreatedDate={setCreatedDate}
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
