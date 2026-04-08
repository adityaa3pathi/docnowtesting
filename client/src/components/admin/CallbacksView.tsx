import { useState, useEffect } from 'react';
import { Search, Filter, PhoneCall, RefreshCw, ChevronLeft, ChevronRight, Loader2, CheckCircle, FileText, Download } from 'lucide-react';
import { useCallbacks, CallbackRequest } from '@/hooks/useCallbacks';
import { useExport } from '@/hooks/useExport';

interface CallbacksViewProps {
    apiPrefix: '/api/admin' | '/api/manager';
    title?: string;
    subtitle?: string;
}

export function CallbacksView({ apiPrefix, title = 'Callback Requests', subtitle = 'Manage and resolve callback requests' }: CallbacksViewProps) {
    const { callbacks, pagination, loading, actionLoading, fetchCallbacks, updateStatus } = useCallbacks(apiPrefix);
    const { exporting, exportCsv } = useExport();

    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [page, setPage] = useState(1);

    const [selectedCallback, setSelectedCallback] = useState<CallbackRequest | null>(null);
    const [notes, setNotes] = useState('');

    useEffect(() => {
        fetchCallbacks({ page, search: searchTerm, status: statusFilter });
    }, [page, statusFilter, fetchCallbacks]); // searchTerm triggers explicitly via debounce

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (page !== 1) setPage(1);
            else fetchCallbacks({ page: 1, search: searchTerm, status: statusFilter });
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const handleResolveSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCallback) return;
        
        const success = await updateStatus(selectedCallback.id, 'RESOLVED', notes);
        if (success) {
            setSelectedCallback(null);
            setNotes('');
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">{title}</h1>
                    <p className="text-gray-600 mt-1">{subtitle}</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => exportCsv('callbacks', { search: searchTerm, status: statusFilter })}
                        disabled={exporting}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                        {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                        Export CSV
                    </button>
                    <button
                        onClick={() => fetchCallbacks({ page, search: searchTerm, status: statusFilter })}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Search by name, mobile, or city..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] focus:border-transparent"
                        />
                    </div>
                    <div className="flex gap-2">
                        {['All', 'PENDING', 'RESOLVED'].map((status) => (
                            <button
                                key={status}
                                onClick={() => { setStatusFilter(status); setPage(1); }}
                                className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                                    statusFilter === status
                                        ? 'bg-[#4b2192] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading && callbacks.length === 0 ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
                    </div>
                ) : callbacks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                        <PhoneCall className="h-12 w-12 text-gray-300 mb-4" />
                        <p>No callback requests found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-100">
                                <tr>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Requested At</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Customer</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">City</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {callbacks.map((cb) => (
                                    <tr key={cb.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 text-sm text-gray-600">
                                            {formatDate(cb.createdAt)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-medium text-gray-900">{cb.name}</p>
                                            <p className="text-sm text-gray-500">{cb.mobile}</p>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600">
                                            {cb.city || '-'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                cb.status === 'RESOLVED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                            }`}>
                                                {cb.status}
                                            </span>
                                            {cb.notes && (
                                                <p className="text-xs text-gray-400 mt-1 max-w-[200px] truncate" title={cb.notes}>
                                                    {cb.notes}
                                                </p>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {cb.status === 'PENDING' ? (
                                                <button
                                                    onClick={() => { setSelectedCallback(cb); setNotes(''); }}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#4b2192] bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                                                >
                                                    <CheckCircle size={16} />
                                                    Resolve
                                                </button>
                                            ) : (
                                                <span className="text-sm text-gray-400">Resolved</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
                {!loading && callbacks.length > 0 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
                        <p className="text-sm text-gray-500">
                            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => p - 1)}
                                disabled={pagination.page <= 1}
                                className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                onClick={() => setPage(p => p + 1)}
                                disabled={pagination.page >= pagination.totalPages}
                                className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Resolve Modal */}
            {selectedCallback && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                        <div className="flex justify-between items-center p-6 border-b border-gray-100">
                            <h3 className="text-lg font-semibold text-gray-900">Resolve Callback</h3>
                            <button onClick={() => setSelectedCallback(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleResolveSubmit}>
                            <div className="p-6 space-y-4">
                                <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-700">
                                    <p><strong>Name:</strong> {selectedCallback.name}</p>
                                    <p><strong>Mobile:</strong> {selectedCallback.mobile}</p>
                                    <p><strong>City:</strong> {selectedCallback.city}</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Resolution Notes (Optional)
                                    </label>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        rows={3}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-[#4b2192] focus:border-[#4b2192] resize-none"
                                        placeholder="E.g., Called user and scheduled test..."
                                    />
                                </div>
                            </div>
                            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setSelectedCallback(null)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={actionLoading === selectedCallback.id}
                                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                                >
                                    {actionLoading === selectedCallback.id && <Loader2 size={16} className="animate-spin" />}
                                    Mark as Resolved
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
