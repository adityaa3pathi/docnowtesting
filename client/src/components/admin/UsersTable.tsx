import { useRouter } from 'next/navigation';
import {
    Eye,
    Ban,
    CheckCircle,
    Wallet,
    Loader2,
    Shield,
    ShieldOff,
} from 'lucide-react';
import { AdminUser } from '@/types/admin';

interface UsersTableProps {
    users: AdminUser[];
    loading: boolean;
    searchTerm: string;
    actionLoading: string | null;
    onBlockUnblock: (user: AdminUser) => void;
    onRoleChange: (user: AdminUser) => void;
    onOpenWallet: (user: AdminUser) => void;
}

export function UsersTable({
    users,
    loading,
    searchTerm,
    actionLoading,
    onBlockUnblock,
    onRoleChange,
    onOpenWallet,
}: UsersTableProps) {
    const router = useRouter();

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
            </div>
        );
    }

    if (users.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <p>No users found</p>
                {searchTerm && <p className="text-sm mt-1">Try adjusting your search</p>}
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
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
                            <td className="px-6 py-4">
                                <span
                                    className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${user.role === 'MANAGER'
                                            ? 'bg-purple-100 text-purple-700'
                                            : 'bg-gray-100 text-gray-600'
                                        }`}
                                >
                                    {user.role === 'MANAGER' && <Shield size={12} />}
                                    {user.role === 'MANAGER' ? 'Manager' : 'User'}
                                </span>
                            </td>
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
                                        onClick={() => onOpenWallet(user)}
                                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title="Adjust Wallet"
                                    >
                                        <Wallet size={18} />
                                    </button>
                                    <button
                                        onClick={() => onRoleChange(user)}
                                        disabled={actionLoading === user.id}
                                        className={`p-2 rounded-lg transition-colors ${user.role === 'MANAGER'
                                                ? 'text-purple-500 hover:text-orange-600 hover:bg-orange-50'
                                                : 'text-gray-500 hover:text-purple-600 hover:bg-purple-50'
                                            }`}
                                        title={user.role === 'MANAGER' ? 'Demote to User' : 'Promote to Manager'}
                                    >
                                        {user.role === 'MANAGER' ? (
                                            <ShieldOff size={18} />
                                        ) : (
                                            <Shield size={18} />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => onBlockUnblock(user)}
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
    );
}
