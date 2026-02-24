'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { AdminUser, AdminPagination, StatusFilter, RoleFilter } from '@/types/admin';

export function useUsers() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [pagination, setPagination] = useState<AdminPagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<StatusFilter>('All');
    const [filterRole, setFilterRole] = useState<RoleFilter>('All');
    const [actionLoading, setActionLoading] = useState<string | null>(null);

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
            if (filterRole !== 'All') params.append('role', filterRole);

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
    }, [pagination.page, pagination.limit, searchTerm, filterStatus, filterRole]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // Debounced search — reset to page 1 when search changes
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const handleBlockUnblock = async (user: AdminUser) => {
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

            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: newStatus } : u));
            toast.success(`User ${newStatus.toLowerCase()} successfully`);
        } catch (error) {
            console.error('Error updating user status:', error);
            toast.error('Failed to update user status');
        } finally {
            setActionLoading(null);
        }
    };

    const handleRoleChange = async (user: AdminUser) => {
        const newRole = user.role === 'MANAGER' ? 'USER' : 'MANAGER';
        const action = newRole === 'MANAGER' ? 'promote to Manager' : 'demote to User';
        const confirmMsg = `Are you sure you want to ${action} for ${user.name || user.mobile}?`;

        if (!confirm(confirmMsg)) return;

        setActionLoading(user.id);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch(`/api/admin/users/${user.id}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ role: newRole }),
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to update role');
            }

            const result = await res.json();
            toast.success(result.message);

            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u));
        } catch (error: any) {
            console.error('Error updating user role:', error);
            toast.error(error.message || 'Failed to update user role');
        } finally {
            setActionLoading(null);
        }
    };

    const updateUserWallet = (userId: string, newBalance: number) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, walletBalance: newBalance } : u));
    };

    const setPage = (page: number) => {
        setPagination(prev => ({ ...prev, page }));
    };

    const setStatusFilter = (status: StatusFilter) => {
        setFilterStatus(status);
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const setRoleFilter = (role: RoleFilter) => {
        setFilterRole(role);
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    return {
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
    };
}
