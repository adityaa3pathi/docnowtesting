'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Search,
    RefreshCw,
    Edit,
    Check,
    X,
    Loader2,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface CatalogItem {
    id: string;
    partnerCode: string;
    name: string;
    type: 'TEST' | 'PACKAGE' | 'PROFILE';
    partnerPrice: number;
    displayPrice: number;
    discountedPrice: number | null;
    isEnabled: boolean;
}

export default function CatalogManagement() {
    const [items, setItems] = useState<CatalogItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [page, setPage] = useState(1);
    const limit = 20;

    // Inline editing state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState({ displayPrice: 0, discountedPrice: '' as string });

    const token = typeof window !== 'undefined' ? localStorage.getItem('docnow_auth_token') : null;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fetchCatalog = useCallback(async () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (typeFilter !== 'all') params.set('type', typeFilter);
        if (statusFilter !== 'all') params.set('enabled', statusFilter === 'enabled' ? 'true' : 'false');
        if (searchTerm) params.set('search', searchTerm);

        try {
            const res = await fetch(`/api/manager/catalog?${params}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setItems(data.items || []);
                setTotal(data.total || 0);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [page, typeFilter, statusFilter, searchTerm]);

    useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

    // Debounced search
    const [searchInput, setSearchInput] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => { setSearchTerm(searchInput); setPage(1); }, 400);
        return () => clearTimeout(timer);
    }, [searchInput]);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const res = await fetch('/api/manager/catalog/sync', {
                method: 'POST',
                headers,
                body: JSON.stringify({ zipcode: '110001' }),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(data.message);
                fetchCatalog();
            } else {
                toast.error(data.error || 'Sync failed');
            }
        } catch { toast.error('Network error during sync'); }
        setSyncing(false);
    };

    const handleToggle = async (id: string) => {
        try {
            const res = await fetch(`/api/manager/catalog/${id}/toggle`, { method: 'PUT', headers });
            if (res.ok) {
                const data = await res.json();
                setItems(prev => prev.map(i => i.id === id ? { ...i, isEnabled: data.isEnabled } : i));
            }
        } catch { /* ignore */ }
    };

    const handleEditClick = (item: CatalogItem) => {
        setEditingId(item.id);
        setEditValues({
            displayPrice: item.displayPrice,
            discountedPrice: item.discountedPrice != null ? String(item.discountedPrice) : '',
        });
    };

    const handleSaveEdit = async (id: string) => {
        try {
            const body: any = { displayPrice: editValues.displayPrice };
            body.discountedPrice = editValues.discountedPrice ? parseFloat(editValues.discountedPrice) : null;

            const res = await fetch(`/api/manager/catalog/${id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(body),
            });

            if (res.ok) {
                const updated = await res.json();
                setItems(prev => prev.map(i => i.id === id ? { ...i, displayPrice: updated.displayPrice, discountedPrice: updated.discountedPrice } : i));
                setEditingId(null);
            }
        } catch { /* ignore */ }
    };

    const totalPages = Math.ceil(total / limit);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">Catalog Management</h1>
                    <p className="text-gray-600 mt-1">Manage tests, packages, and pricing</p>
                </div>
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium disabled:opacity-60 transition-colors w-full sm:w-auto"
                    style={{ backgroundColor: '#4b2192' }}
                >
                    <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Syncing...' : 'Sync from Healthians'}
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="search"
                            placeholder="Search products..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                            style={{ focusRingColor: '#4b2192' } as any}
                        />
                    </div>
                    <select
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2"
                    >
                        <option value="all">All Types</option>
                        <option value="TEST">Test</option>
                        <option value="PACKAGE">Package</option>
                        <option value="PROFILE">Profile</option>
                    </select>
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2"
                    >
                        <option value="all">All Status</option>
                        <option value="enabled">Enabled</option>
                        <option value="disabled">Disabled</option>
                    </select>
                </div>
            </div>

            {/* Products Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">Products ({total})</h2>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="text-center py-16 text-gray-500">
                        No products found. Try syncing from Healthians.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 text-left">
                                    <th className="px-6 py-3 font-medium text-gray-500">Name</th>
                                    <th className="px-6 py-3 font-medium text-gray-500">Type</th>
                                    <th className="px-6 py-3 font-medium text-gray-500">Base Price</th>
                                    <th className="px-6 py-3 font-medium text-gray-500">Display Price</th>
                                    <th className="px-6 py-3 font-medium text-gray-500">Discounted</th>
                                    <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                                    <th className="px-6 py-3 font-medium text-gray-500 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item, index) => (
                                    <tr key={item.id} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-gray-50/50' : ''}`}>
                                        <td className="px-6 py-3 font-medium text-gray-900 max-w-xs truncate">{item.name}</td>
                                        <td className="px-6 py-3">
                                            <span className="px-2 py-0.5 rounded-full border text-xs font-medium text-gray-700 border-gray-300">
                                                {item.type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-gray-500">₹{item.partnerPrice}</td>
                                        <td className="px-6 py-3">
                                            {editingId === item.id ? (
                                                <input
                                                    type="number"
                                                    value={editValues.displayPrice}
                                                    onChange={(e) => setEditValues(v => ({ ...v, displayPrice: Number(e.target.value) }))}
                                                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                                                />
                                            ) : (
                                                <span className="font-medium">₹{item.displayPrice}</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3">
                                            {editingId === item.id ? (
                                                <input
                                                    type="number"
                                                    value={editValues.discountedPrice}
                                                    onChange={(e) => setEditValues(v => ({ ...v, discountedPrice: e.target.value }))}
                                                    placeholder="Optional"
                                                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                                                />
                                            ) : item.discountedPrice ? (
                                                <span className="font-medium text-green-600">₹{item.discountedPrice}</span>
                                            ) : (
                                                <span className="text-gray-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.isEnabled
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                {item.isEnabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                {editingId === item.id ? (
                                                    <>
                                                        <button
                                                            onClick={() => handleSaveEdit(item.id)}
                                                            className="h-8 w-8 flex items-center justify-center rounded-lg text-white"
                                                            style={{ backgroundColor: '#10b981' }}
                                                        >
                                                            <Check className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingId(null)}
                                                            className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => handleEditClick(item)}
                                                        className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </button>
                                                )}
                                                {/* Toggle switch */}
                                                <button
                                                    onClick={() => handleToggle(item.id)}
                                                    className={`relative w-11 h-6 rounded-full transition-colors ${item.isEnabled ? 'bg-green-500' : 'bg-gray-300'
                                                        }`}
                                                >
                                                    <span
                                                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${item.isEnabled ? 'translate-x-5' : ''
                                                            }`}
                                                    />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                        <span className="text-sm text-gray-500">Page {page} of {totalPages} ({total} items)</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="p-2 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="p-2 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
