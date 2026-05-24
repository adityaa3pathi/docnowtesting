'use client';

import { useState, useEffect, useCallback } from 'react';
import { TestTube, Plus, Search, Loader2, GripVertical, CheckCircle, XCircle, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface Category {
    id: string;
    name: string;
}

interface CatalogItem {
    id: string;
    partnerCode: string;
    name: string;
    type: 'TEST' | 'PACKAGE' | 'PROFILE';
    displayPrice: number;
    discountedPrice: number | null;
    isEnabled: boolean;
    isFeatured: boolean;
    featuredOrder: number | null;
    categories: Category[];
}

export default function FeaturedTestsPage() {
    const [tests, setTests] = useState<CatalogItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Add modal state
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [modalItems, setModalItems] = useState<CatalogItem[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [modalPage, setModalPage] = useState(1);
    const [modalTotalPages, setModalTotalPages] = useState(1);
    const [modalTotalCount, setModalTotalCount] = useState(0);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isAdding, setIsAdding] = useState(false);
    
    // Drag state
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);

    const fetchFeaturedTests = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/admin/featured-tests');
            setTests(res.data.products || []);
        } catch (error) {
            console.error('Failed to fetch featured tests', error);
            toast.error('Failed to load featured tests');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchFeaturedTests();
    }, []);

    // Fetch modal items with pagination
    const fetchModalItems = useCallback(async (page: number, search: string) => {
        setIsSearching(true);
        try {
            const params: any = { page, limit: 20 };
            if (search.trim()) params.search = search.trim();
            const res = await api.get('/admin/featured-tests/search', { params });
            setModalItems(res.data.products || []);
            setModalTotalPages(res.data.totalPages || 1);
            setModalTotalCount(res.data.totalCount || 0);
            setModalPage(res.data.page || 1);
        } catch (error) {
            console.error('Search failed', error);
        } finally {
            setIsSearching(false);
        }
    }, []);

    // Load first page when modal opens
    useEffect(() => {
        if (isAddModalOpen) {
            setSelectedIds(new Set());
            setSearchInput('');
            setSearchQuery('');
            setModalPage(1);
            fetchModalItems(1, '');
        }
    }, [isAddModalOpen, fetchModalItems]);

    // Debounced search
    useEffect(() => {
        if (!isAddModalOpen) return;
        const timer = setTimeout(() => {
            setSearchQuery(searchInput);
            setModalPage(1);
            fetchModalItems(1, searchInput);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchInput, isAddModalOpen, fetchModalItems]);

    // Re-fetch on page change
    const handleModalPageChange = (newPage: number) => {
        setModalPage(newPage);
        fetchModalItems(newPage, searchQuery);
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleBatchAdd = async () => {
        if (selectedIds.size === 0) return;
        setIsAdding(true);
        try {
            await api.post('/admin/featured-tests', { catalogItemIds: Array.from(selectedIds) });
            toast.success(`${selectedIds.size} test(s) added to featured list`);
            setIsAddModalOpen(false);
            fetchFeaturedTests();
        } catch (error) {
            console.error('Failed to add tests', error);
            toast.error('Failed to add tests');
        } finally {
            setIsAdding(false);
        }
    };

    const handleRemoveTest = async (id: string, name: string) => {
        if (!window.confirm(`Are you sure you want to remove "${name}" from featured tests?`)) {
            return;
        }

        try {
            setTests(prev => prev.filter(t => t.id !== id));
            await api.delete(`/admin/featured-tests/${id}`);
            toast.success('Test removed');
        } catch (error) {
            console.error('Failed to remove test', error);
            toast.error('Failed to remove test');
            fetchFeaturedTests();
        }
    };

    const toggleStatus = async (id: string, currentStatus: boolean) => {
        try {
            setTests(prev => prev.map(t => t.id === id ? { ...t, isEnabled: !currentStatus } : t));
            await api.put(`/admin/featured-tests/${id}/toggle`, { isEnabled: !currentStatus });
            toast.success(`Test ${!currentStatus ? 'enabled' : 'disabled'}`);
        } catch (error) {
            console.error('Failed to toggle status', error);
            toast.error('Failed to update status');
            fetchFeaturedTests();
        }
    };

    // --- Drag and Drop Handlers ---
    const onDragStart = (e: React.DragEvent<HTMLTableRowElement>, index: number) => {
        setDraggedItemIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.style.opacity = '0.5';
    };

    const onDragEnter = (e: React.DragEvent<HTMLTableRowElement>, index: number) => {
        if (draggedItemIndex === null || draggedItemIndex === index) return;
        
        const newTests = [...tests];
        const draggedItem = newTests[draggedItemIndex];
        
        newTests.splice(draggedItemIndex, 1);
        newTests.splice(index, 0, draggedItem);
        
        setDraggedItemIndex(index);
        setTests(newTests);
    };

    const onDragEnd = async (e: React.DragEvent<HTMLTableRowElement>) => {
        e.currentTarget.style.opacity = '1';
        
        if (draggedItemIndex !== null) {
            setDraggedItemIndex(null);
            
            const orderedIds = tests.map(t => t.id);
            try {
                await api.put('/admin/featured-tests/reorder', { orderedIds });
                toast.success('Order saved');
            } catch (error) {
                console.error('Failed to save order', error);
                toast.error('Failed to save new order');
                fetchFeaturedTests();
            }
        }
    };

    return (
        <div className="p-6 max-w-[1200px] mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <TestTube className="w-6 h-6 text-primary" /> Homepage Lab Tests
                    </h1>
                    <p className="text-gray-500 mt-1">Manage which tests appear in the &quot;Individual Lab Tests&quot; section</p>
                </div>
                <button 
                    onClick={() => setIsAddModalOpen(true)}
                    className="bg-[#4b2192] text-white px-5 py-2.5 rounded-xl flex items-center gap-2 font-medium hover:bg-[#3d1a7a] transition-all shadow-lg shadow-purple-900/10 active:scale-95"
                >
                    <Plus size={18} /> Add Test
                </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {isLoading ? (
                    <div className="p-12 flex justify-center text-gray-400">
                        <Loader2 className="animate-spin w-8 h-8" />
                    </div>
                ) : tests.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        No featured tests found. Add one to show it on the homepage.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50/50 text-gray-500 font-medium text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="px-4 py-4 w-12 text-center"></th>
                                    <th className="px-6 py-4">Test Details</th>
                                    <th className="px-6 py-4">Price</th>
                                    <th className="px-6 py-4">Categories</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {tests.map((test, index) => {
                                    const price = test.discountedPrice ?? test.displayPrice;
                                    const mrp = test.discountedPrice ? test.displayPrice : null;
                                    
                                    return (
                                        <tr 
                                            key={test.id} 
                                            className="hover:bg-gray-50/50 transition-colors group cursor-grab active:cursor-grabbing"
                                            draggable
                                            onDragStart={(e) => onDragStart(e, index)}
                                            onDragEnter={(e) => onDragEnter(e, index)}
                                            onDragEnd={onDragEnd}
                                            onDragOver={(e) => e.preventDefault()}
                                        >
                                            <td className="px-4 py-4 text-center text-gray-300 group-hover:text-gray-500">
                                                <GripVertical size={20} className="mx-auto" />
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-900">{test.name}</div>
                                                <div className="text-xs text-gray-400 font-medium">{test.partnerCode} • {test.type}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-900">₹{price}</div>
                                                {mrp && <div className="text-xs text-gray-400 line-through">₹{mrp}</div>}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-wrap gap-1">
                                                    {test.categories.slice(0, 2).map(c => (
                                                        <span key={c.id} className="text-[10px] uppercase font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                                            {c.name}
                                                        </span>
                                                    ))}
                                                    {test.categories.length > 2 && (
                                                        <span className="text-[10px] uppercase font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                                            +{test.categories.length - 2}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => toggleStatus(test.id, test.isEnabled)}
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${test.isEnabled
                                                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                        }`}
                                                >
                                                    {test.isEnabled ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                    {test.isEnabled ? 'Active' : 'Inactive'}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    onClick={() => handleRemoveTest(test.id, test.name)}
                                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Remove from featured"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add Modal — Paginated with Multi-select */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900">Add Tests to Homepage</h2>
                                <p className="text-sm text-gray-500 mt-0.5">{modalTotalCount} available tests</p>
                            </div>
                            <button 
                                onClick={() => setIsAddModalOpen(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="p-4 border-b border-gray-100">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                <input
                                    type="text"
                                    placeholder="Search lab tests..."
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    autoFocus
                                    className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                />
                                {searchInput && (
                                    <button onClick={() => setSearchInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                        <X size={16} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0">
                            {isSearching ? (
                                <div className="p-12 flex justify-center text-gray-400">
                                    <Loader2 className="animate-spin w-6 h-6" />
                                </div>
                            ) : modalItems.length === 0 ? (
                                <div className="p-12 text-center text-gray-500 text-sm">
                                    No non-featured tests found.
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {modalItems.map(item => {
                                        const price = item.discountedPrice ?? item.displayPrice;
                                        const isSelected = selectedIds.has(item.id);
                                        return (
                                            <label
                                                key={item.id}
                                                className={`flex items-center gap-4 px-6 py-3.5 cursor-pointer transition-colors ${isSelected ? 'bg-purple-50/50' : 'hover:bg-gray-50'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelect(item.id)}
                                                    className="w-4 h-4 rounded border-gray-300 text-[#4b2192] focus:ring-[#4b2192]/20 shrink-0"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-semibold text-gray-900 text-sm truncate">{item.name}</div>
                                                    <div className="text-xs text-gray-400 mt-0.5">{item.partnerCode}</div>
                                                </div>
                                                <div className="text-sm font-bold text-gray-700 shrink-0">₹{price}</div>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Pagination */}
                        {modalTotalPages > 1 && (
                            <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/30">
                                <span className="text-xs text-gray-500">Page {modalPage} of {modalTotalPages}</span>
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={() => handleModalPageChange(modalPage - 1)}
                                        disabled={modalPage <= 1}
                                        className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-40 transition-colors"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleModalPageChange(modalPage + 1)}
                                        disabled={modalPage >= modalTotalPages}
                                        className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-40 transition-colors"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Footer with Add Selected button */}
                        <div className="p-4 border-t border-gray-200 bg-white flex items-center justify-between">
                            <span className="text-sm text-gray-500">
                                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select tests to add'}
                            </span>
                            <button
                                onClick={handleBatchAdd}
                                disabled={selectedIds.size === 0 || isAdding}
                                className="bg-[#4b2192] text-white px-6 py-2.5 rounded-xl font-medium hover:bg-[#3d1a7a] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95"
                            >
                                {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                Add {selectedIds.size > 0 ? `${selectedIds.size} Test${selectedIds.size > 1 ? 's' : ''}` : 'Selected'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
