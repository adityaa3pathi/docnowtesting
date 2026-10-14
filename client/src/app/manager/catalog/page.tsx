'use client';

import { useState, useEffect } from 'react';
import { Loader2, Search, ChevronLeft, ChevronRight, Check, Info } from 'lucide-react';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';

const MAX_PURPOSE = 300; // keep in sync with server PURPOSE_MAX_LENGTH
const PAGE_SIZE = 50;

type ItemType = 'TEST' | 'PROFILE' | 'PACKAGE';

interface CatalogItem {
    id: string;
    name: string;
    type: ItemType;
    purpose: string | null;
    isEnabled: boolean;
}

interface ListResult {
    key: string;
    items: CatalogItem[];
    total: number;
    error: string | null;
}

type RowStatus = { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

const TYPE_BADGE: Record<ItemType, string> = {
    TEST: 'bg-blue-100 text-blue-800',
    PROFILE: 'bg-amber-100 text-amber-800',
    PACKAGE: 'bg-purple-100 text-purple-800',
};

function apiError(error: unknown, fallback: string): string {
    const data = (error as { response?: { data?: { error?: unknown } } })?.response?.data;
    return typeof data?.error === 'string' ? data.error : fallback;
}

export default function CatalogPurposePage() {
    const [page, setPage] = useState(1);
    const [typeFilter, setTypeFilter] = useState<'' | ItemType>('');
    const [searchInput, setSearchInput] = useState('');
    const [retryNonce, setRetryNonce] = useState(0);
    const [result, setResult] = useState<ListResult | null>(null);

    // Drafts and statuses are keyed by item id so edits survive paging.
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});

    const search = useDebounce(searchInput.trim(), 350);

    // Loading is derived: the shown result belongs to an older query until the new one lands.
    const queryKey = `${page}|${search}|${typeFilter}|${retryNonce}`;
    const loading = result?.key !== queryKey;
    const loadError = !loading && result?.error ? result.error : null;
    const items = !loading && result ? result.items : [];
    // Keep the last known total so paging controls do not flicker while loading.
    const total = result && !result.error ? result.total : 0;

    useEffect(() => {
        let cancelled = false;
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
        if (search) params.set('search', search);
        if (typeFilter) params.set('type', typeFilter);
        api.get(`/manager/catalog?${params.toString()}`)
            .then(res => {
                if (cancelled) return;
                setResult({ key: queryKey, items: res.data.items || [], total: res.data.total || 0, error: null });
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setResult({ key: queryKey, items: [], total: 0, error: apiError(error, 'Could not load products') });
            });
        return () => { cancelled = true; };
    }, [queryKey, page, search, typeFilter]);

    const handleChange = (id: string, value: string) => {
        setDrafts(prev => ({ ...prev, [id]: value }));
        setStatuses(prev => {
            if (!prev[id] || prev[id].kind === 'saving') return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
    };

    const handleSave = async (item: CatalogItem) => {
        const value = (drafts[item.id] ?? item.purpose ?? '').trim();
        setStatuses(prev => ({ ...prev, [item.id]: { kind: 'saving' } }));
        try {
            const res = await api.put(`/manager/catalog/${item.id}/purpose`, { purpose: value || null });
            const saved: string | null = res.data.purpose ?? null;
            setResult(prev => prev && {
                ...prev,
                items: prev.items.map(i => (i.id === item.id ? { ...i, purpose: saved } : i)),
            });
            // Keep any text typed while the save was in flight.
            setDrafts(prev => {
                if ((prev[item.id] ?? '').trim() !== value) return prev;
                const next = { ...prev };
                delete next[item.id];
                return next;
            });
            setStatuses(prev => ({ ...prev, [item.id]: { kind: 'saved' } }));
        } catch (error: unknown) {
            const message = apiError(error, 'Could not save. Please try again.');
            setStatuses(prev => ({ ...prev, [item.id]: { kind: 'error', message } }));
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-semibold text-gray-900">Product descriptions</h1>
                <p className="text-gray-600 mt-1">
                    Write what each product is for. This text replaces the test list on product cards.
                </p>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Changes can take up to 5 minutes to show on the website.</span>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                        type="text"
                        aria-label="Search products by name"
                        placeholder="Search products..."
                        value={searchInput}
                        onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    />
                </div>
                <select
                    aria-label="Filter by product type"
                    value={typeFilter}
                    onChange={(e) => { setTypeFilter(e.target.value as '' | ItemType); setPage(1); }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                    <option value="">All types</option>
                    <option value="TEST">Tests</option>
                    <option value="PROFILE">Profiles</option>
                    <option value="PACKAGE">Packages</option>
                </select>
            </div>

            {/* List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                ) : loadError ? (
                    <div className="p-12 text-center">
                        <p className="text-red-600 mb-4">{loadError}</p>
                        <button
                            onClick={() => setRetryNonce(n => n + 1)}
                            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50"
                        >
                            Retry
                        </button>
                    </div>
                ) : items.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        {search || typeFilter ? 'No items match' : 'No products yet.'}
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {items.map(item => {
                            const original = item.purpose ?? '';
                            const draft = drafts[item.id] ?? original;
                            const trimmedLen = draft.trim().length;
                            const tooLong = trimmedLen > MAX_PURPOSE;
                            const dirty = draft.trim() !== original.trim();
                            const status = statuses[item.id];
                            const saving = status?.kind === 'saving';
                            const fieldId = `purpose-${item.id}`;
                            const counterId = `purpose-count-${item.id}`;

                            return (
                                <li
                                    key={item.id}
                                    className={`px-6 py-4 border-l-4 ${dirty ? 'border-amber-400 bg-amber-50/40' : 'border-transparent'}`}
                                >
                                    <div className="flex flex-wrap items-center gap-2 mb-2">
                                        <label htmlFor={fieldId} className="font-medium text-gray-900">{item.name}</label>
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[item.type] || 'bg-gray-100 text-gray-600'}`}>
                                            {item.type}
                                        </span>
                                        {!item.isEnabled && <span className="text-xs text-gray-400">(disabled)</span>}
                                        {dirty && <span className="text-xs font-medium text-amber-700">Unsaved changes</span>}
                                    </div>
                                    <textarea
                                        id={fieldId}
                                        aria-label={`What ${item.name} is for`}
                                        aria-describedby={counterId}
                                        aria-invalid={tooLong}
                                        value={draft}
                                        onChange={(e) => handleChange(item.id, e.target.value)}
                                        placeholder="What it's for, e.g. Checks your thyroid hormone levels."
                                        rows={2}
                                        className={`w-full px-3 py-2 border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 ${tooLong ? 'border-red-400 focus:ring-red-500/20' : 'border-gray-300 focus:ring-purple-500/20 focus:border-purple-500'}`}
                                    />
                                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                                        <span id={counterId} className={`text-xs ${tooLong ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                                            {trimmedLen}/{MAX_PURPOSE}
                                            {tooLong && ` · Too long by ${trimmedLen - MAX_PURPOSE}`}
                                        </span>
                                        <div className="flex items-center gap-3">
                                            <span role="status" aria-live="polite" className="text-xs">
                                                {status?.kind === 'saved' && (
                                                    <span className="flex items-center gap-1 text-green-700">
                                                        <Check className="h-3.5 w-3.5" /> Saved
                                                    </span>
                                                )}
                                                {status?.kind === 'error' && <span className="text-red-600">{status.message}</span>}
                                            </span>
                                            <button
                                                onClick={() => handleSave(item)}
                                                disabled={!dirty || tooLong || saving}
                                                aria-label={`Save description for ${item.name}`}
                                                className="px-4 py-1.5 rounded-lg text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                style={{ backgroundColor: '#4b2192' }}
                                            >
                                                {saving ? 'Saving...' : 'Save'}
                                            </button>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Pagination */}
            {!loadError && total > 0 && (
                <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>{total} products · Page {page} of {totalPages}</span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page <= 1 || loading}
                            aria-label="Previous page"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 font-medium hover:bg-gray-50 disabled:opacity-50"
                        >
                            <ChevronLeft className="h-4 w-4" /> Prev
                        </button>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages || loading}
                            aria-label="Next page"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 font-medium hover:bg-gray-50 disabled:opacity-50"
                        >
                            Next <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
