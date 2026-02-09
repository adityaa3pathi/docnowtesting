'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Search,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    Loader2,
    ShieldAlert,
    Clock
} from 'lucide-react';

interface AuditLog {
    id: string;
    adminName: string;
    action: string;
    entity: string;
    targetId: string;
    oldValue: any;
    newValue: any;
    ipAddress: string | null;
    isDestructive: boolean;
    createdAt: string;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export default function AuditLogsPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState('All');

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
                action: actionFilter,
            });

            if (searchTerm) params.append('search', searchTerm);

            const res = await fetch(`/api/admin/audit-logs?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) throw new Error('Failed to fetch audit logs');

            const data = await res.json();
            setLogs(data.logs);
            setPagination(data.pagination);
        } catch (error) {
            console.error('Error fetching audit logs:', error);
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, searchTerm, actionFilter]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const formatDateTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const getActionColor = (action: string, isDestructive: boolean) => {
        if (isDestructive) return 'bg-red-100 text-red-700';
        if (action.includes('CREATE')) return 'bg-green-100 text-green-700';
        if (action.includes('UPDATE') || action.includes('EDIT')) return 'bg-blue-100 text-blue-700';
        return 'bg-gray-100 text-gray-700';
    };

    const renderChanges = (log: AuditLog) => {
        try {
            //   const oldVal = typeof log.oldValue === 'string' ? JSON.parse(log.oldValue) : log.oldValue;
            //   const newVal = typeof log.newValue === 'string' ? JSON.parse(log.newValue) : log.newValue;

            // Simplified view for now
            if (log.action.includes('WALLET')) {
                return (
                    <span className="text-xs font-mono">
                        {log.newValue.amount > 0 ? '+' : ''}{log.newValue.amount} (Bal: {log.newValue.balance})
                    </span>
                )
            }

            if (log.action.includes('USER_BLOCKED')) {
                return <span className="text-xs text-red-600">Status: BLOCKED</span>;
            }

            if (log.action.includes('CONFIG')) {
                return (
                    <div className="text-xs">
                        <span className="text-gray-400 line-through mr-2">{log.oldValue?.value}</span>
                        <span className="text-green-600 font-medium">{log.newValue.value}</span>
                    </div>
                )
            }

            return <span className="text-xs text-gray-500">View Details</span>;

        } catch (e) {
            return <span className="text-xs text-gray-400">Complex Data</span>;
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">Audit Logs</h1>
                    <p className="text-gray-600 mt-1">Track all administrative actions for security and accountability</p>
                </div>
                <button
                    onClick={fetchLogs}
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
                            placeholder="Search by Admin, Entity, or Target ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] focus:border-transparent"
                        />
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
                        {/* Common Actions Filter */}
                        {['All', 'USER_BLOCKED', 'USER_UNBLOCKED', 'WALLET_ADJUSTMENT', 'CONFIG_UPDATED'].map((action) => (
                            <button
                                key={action}
                                onClick={() => {
                                    setActionFilter(action);
                                    setPagination(prev => ({ ...prev, page: 1 }));
                                }}
                                className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${actionFilter === action
                                        ? 'bg-[#4b2192] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                {action === 'All' ? 'All Actions' : action.replace(/_/g, ' ')}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Logs Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
                    </div>
                ) : logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                        <ShieldAlert size={48} className="text-gray-200 mb-4" />
                        <p>No audit logs found</p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-100">
                                    <tr>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Admin</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Entity / Target</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Changes</th>
                                        <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                <div className="flex items-center gap-2">
                                                    <Clock size={14} className="text-gray-400" />
                                                    {formatDateTime(log.createdAt)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="font-medium text-gray-900">{log.adminName}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getActionColor(log.action, log.isDestructive)}`}>
                                                    {log.action.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">{log.entity}</p>
                                                    <p className="text-xs font-mono text-gray-400">{log.targetId}</p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                {renderChanges(log)}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-500 font-mono">
                                                {log.ipAddress || 'Unknown'}
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
                                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} logs
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
        </div>
    );
}
