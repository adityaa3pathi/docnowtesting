'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Tent, Plus, Search, Loader2, CheckCircle, XCircle,
    Edit3, Package, X, ChevronLeft, ChevronRight, Calendar
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface CampItem {
    id: string;
    catalogItemId: string;
    catalogItem: {
        id: string;
        name: string;
        partnerCode: string;
        type: string;
    };
}

interface Camp {
    id: string;
    name: string;
    description: string | null;
    location: string;
    city: string;
    pincode: string;
    startDate: string;
    endDate: string;
    price: number;
    isActive: boolean;
    items: CampItem[];
    _count: {
        bookings: number;
    };
}

interface CatalogSearchItem {
    id: string;
    name: string;
    partnerCode: string;
    type: string;
    displayPrice: number;
}

interface CampFormData {
    name: string;
    description: string;
    location: string;
    city: string;
    pincode: string;
    startDate: string;
    endDate: string;
    price: string;
}

const defaultForm: CampFormData = {
    name: '',
    description: '',
    location: '',
    city: '',
    pincode: '',
    startDate: '',
    endDate: '',
    price: '',
};

export default function CampsPage() {
    const [camps, setCamps] = useState<Camp[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCamp, setEditingCamp] = useState<Camp | null>(null);
    const [form, setForm] = useState<CampFormData>(defaultForm);
    const [isSaving, setIsSaving] = useState(false);

    // Catalog search in modal
    const [catalogSearch, setCatalogSearch] = useState('');
    const [catalogResults, setCatalogResults] = useState<CatalogSearchItem[]>([]);
    const [isSearchingCatalog, setIsSearchingCatalog] = useState(false);
    const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
    const [selectedItemsMap, setSelectedItemsMap] = useState<Map<string, { name: string; partnerCode: string; type: string }>>(new Map());

    // Items update modal
    const [isItemsModalOpen, setIsItemsModalOpen] = useState(false);
    const [itemsEditCamp, setItemsEditCamp] = useState<Camp | null>(null);
    const [itemsCatalogSearch, setItemsCatalogSearch] = useState('');
    const [itemsCatalogResults, setItemsCatalogResults] = useState<CatalogSearchItem[]>([]);
    const [isSearchingItemsCatalog, setIsSearchingItemsCatalog] = useState(false);
    const [itemsSelectedIds, setItemsSelectedIds] = useState<Set<string>>(new Set());
    const [isSavingItems, setIsSavingItems] = useState(false);

    const fetchCamps = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/admin/camps');
            setCamps(res.data.camps || res.data || []);
        } catch (error) {
            console.error('Failed to fetch camps', error);
            toast.error('Failed to load camps');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCamps();
    }, []);

    // Debounced catalog search in create/edit modal
    useEffect(() => {
        if (!isModalOpen) return;
        if (!catalogSearch.trim()) {
            setCatalogResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearchingCatalog(true);
            try {
                const res = await api.get(`/admin/featured-packages/search?q=${encodeURIComponent(catalogSearch.trim())}`);
                setCatalogResults(res.data.products || res.data || []);
            } catch (error) {
                console.error('Catalog search failed', error);
            } finally {
                setIsSearchingCatalog(false);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [catalogSearch, isModalOpen]);

    // Debounced catalog search in items modal
    useEffect(() => {
        if (!isItemsModalOpen) return;
        if (!itemsCatalogSearch.trim()) {
            setItemsCatalogResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearchingItemsCatalog(true);
            try {
                const res = await api.get(`/admin/featured-packages/search?q=${encodeURIComponent(itemsCatalogSearch.trim())}`);
                setItemsCatalogResults(res.data.products || res.data || []);
            } catch (error) {
                console.error('Catalog search failed', error);
            } finally {
                setIsSearchingItemsCatalog(false);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [itemsCatalogSearch, isItemsModalOpen]);

    const filteredCamps = camps.filter(camp => {
        const matchesSearch = !search || camp.name.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = statusFilter === 'all'
            || (statusFilter === 'active' && camp.isActive)
            || (statusFilter === 'inactive' && !camp.isActive);
        return matchesSearch && matchesStatus;
    });

    const openCreateModal = () => {
        setEditingCamp(null);
        setForm(defaultForm);
        setSelectedCatalogIds(new Set());
        setSelectedItemsMap(new Map());
        setCatalogSearch('');
        setCatalogResults([]);
        setIsModalOpen(true);
    };

    const openEditModal = (camp: Camp) => {
        setEditingCamp(camp);
        setForm({
            name: camp.name,
            description: camp.description || '',
            location: camp.location,
            city: camp.city,
            pincode: camp.pincode,
            startDate: camp.startDate.split('T')[0],
            endDate: camp.endDate.split('T')[0],
            price: String(camp.price),
        });
        setSelectedCatalogIds(new Set(camp.items.map(i => i.catalogItemId)));
        setSelectedItemsMap(new Map(camp.items.map(i => [i.catalogItemId, { name: i.catalogItem.name, partnerCode: i.catalogItem.partnerCode, type: i.catalogItem.type }])));
        setCatalogSearch('');
        setCatalogResults([]);
        setIsModalOpen(true);
    };

    const openItemsModal = (camp: Camp) => {
        setItemsEditCamp(camp);
        setItemsSelectedIds(new Set(camp.items.map(i => i.catalogItemId)));
        setItemsCatalogSearch('');
        setItemsCatalogResults([]);
        setIsItemsModalOpen(true);
    };

    const handleSubmit = async () => {
        if (!form.name.trim() || !form.location.trim() || !form.city.trim() || !form.startDate || !form.endDate || !form.price) {
            toast.error('Please fill in all required fields');
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                description: form.description.trim() || null,
                location: form.location.trim(),
                city: form.city.trim(),
                pincode: form.pincode.trim(),
                startDate: new Date(form.startDate).toISOString(),
                endDate: new Date(form.endDate).toISOString(),
                price: parseFloat(form.price),
                catalogItemIds: Array.from(selectedCatalogIds),
            };

            if (editingCamp) {
                await api.put(`/admin/camps/${editingCamp.id}`, payload);
                toast.success('Camp updated successfully');
            } else {
                await api.post('/admin/camps', payload);
                toast.success('Camp created successfully');
            }

            setIsModalOpen(false);
            fetchCamps();
        } catch (error: any) {
            console.error('Failed to save camp', error);
            toast.error(error.response?.data?.error || 'Failed to save camp');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveItems = async () => {
        if (!itemsEditCamp) return;
        setIsSavingItems(true);
        try {
            await api.put(`/admin/camps/${itemsEditCamp.id}/items`, {
                catalogItemIds: Array.from(itemsSelectedIds),
            });
            toast.success('Camp items updated');
            setIsItemsModalOpen(false);
            fetchCamps();
        } catch (error: any) {
            console.error('Failed to update items', error);
            toast.error(error.response?.data?.error || 'Failed to update items');
        } finally {
            setIsSavingItems(false);
        }
    };

    const toggleCampStatus = async (camp: Camp) => {
        try {
            await api.delete(`/admin/camps/${camp.id}`);
            toast.success(`Camp ${camp.isActive ? 'deactivated' : 'activated'}`);
            fetchCamps();
        } catch (error: any) {
            console.error('Failed to toggle camp status', error);
            toast.error(error.response?.data?.error || 'Failed to update status');
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const toggleCatalogItem = (id: string, item?: { name: string; partnerCode: string; type: string }) => {
        setSelectedCatalogIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        setSelectedItemsMap(prev => {
            const next = new Map(prev);
            if (next.has(id)) next.delete(id);
            else if (item) next.set(id, item);
            return next;
        });
    };

    const toggleItemsCatalogItem = (id: string) => {
        setItemsSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Tent className="w-6 h-6 text-primary" /> Health Camps
                    </h1>
                    <p className="text-gray-500 mt-1">Create and manage health camp events</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="bg-[#4b2192] text-white px-5 py-2.5 rounded-xl flex items-center gap-2 font-medium hover:bg-[#3d1a7a] transition-all shadow-lg shadow-purple-900/10 active:scale-95"
                >
                    <Plus size={18} /> Create Camp
                </button>
            </div>

            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search by camp name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all"
                    />
                </div>
                <div className="flex gap-2">
                    {(['all', 'active', 'inactive'] as const).map(status => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${statusFilter === status
                                ? 'bg-[#4b2192] text-white shadow-lg shadow-purple-900/10'
                                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                                }`}
                        >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {isLoading ? (
                    <div className="p-12 flex justify-center text-gray-400">
                        <Loader2 className="animate-spin w-8 h-8" />
                    </div>
                ) : filteredCamps.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        No camps found. Create one to get started.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50/50 text-gray-500 font-medium text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="px-6 py-4">Name</th>
                                    <th className="px-6 py-4">City</th>
                                    <th className="px-6 py-4">Dates</th>
                                    <th className="px-6 py-4">Price</th>
                                    <th className="px-6 py-4">Tests/Packages</th>
                                    <th className="px-6 py-4">Registrations</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredCamps.map(camp => (
                                    <tr key={camp.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-gray-900">{camp.name}</div>
                                            {camp.description && (
                                                <div className="text-xs text-gray-400 truncate max-w-[200px]">{camp.description}</div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600">{camp.city}</td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-gray-600 flex items-center gap-1.5">
                                                <Calendar size={14} className="text-gray-400" />
                                                {formatDate(camp.startDate)} — {formatDate(camp.endDate)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-gray-900">₹{camp.price}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium text-sm">
                                                <Package size={14} />
                                                {camp.items.length}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600">
                                            <span className="font-medium text-gray-900">{camp._count.bookings}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => toggleCampStatus(camp)}
                                                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${camp.isActive
                                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {camp.isActive ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {camp.isActive ? 'Active' : 'Inactive'}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => openEditModal(camp)}
                                                    className="p-2 text-gray-400 hover:text-[#4b2192] hover:bg-purple-50 rounded-lg transition-colors"
                                                    title="Edit Camp"
                                                >
                                                    <Edit3 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => openItemsModal(camp)}
                                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                    title="Update Items"
                                                >
                                                    <Package size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Create/Edit Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900">
                                    {editingCamp ? 'Edit Camp' : 'Create New Camp'}
                                </h2>
                                <p className="text-sm text-gray-500 mt-0.5">
                                    {editingCamp ? 'Update camp details and items' : 'Set up a new health camp event'}
                                </p>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-5">
                            {/* Name */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Camp Name *</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. Wellness Camp - Indiranagar"
                                    className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                                <textarea
                                    value={form.description}
                                    onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Brief description of the health camp..."
                                    rows={3}
                                    className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm resize-none"
                                />
                            </div>

                            {/* Location, City, Pincode */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Location *</label>
                                    <input
                                        type="text"
                                        value={form.location}
                                        onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))}
                                        placeholder="Venue address"
                                        className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">City *</label>
                                    <input
                                        type="text"
                                        value={form.city}
                                        onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))}
                                        placeholder="City"
                                        className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Pincode</label>
                                    <input
                                        type="text"
                                        value={form.pincode}
                                        onChange={(e) => setForm(f => ({ ...f, pincode: e.target.value }))}
                                        placeholder="560038"
                                        className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    />
                                </div>
                            </div>

                            {/* Dates & Price */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date *</label>
                                    <input
                                        type="date"
                                        value={form.startDate}
                                        onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date *</label>
                                    <input
                                        type="date"
                                        value={form.endDate}
                                        onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Price (₹) *</label>
                                    <input
                                        type="number"
                                        value={form.price}
                                        onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                                        placeholder="999"
                                        min="0"
                                        className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    />
                                </div>
                            </div>

                            {/* Catalog Item Search */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Tests & Packages ({selectedCatalogIds.size} selected)
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Search tests or packages to add..."
                                        value={catalogSearch}
                                        onChange={(e) => setCatalogSearch(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                    />
                                    {catalogSearch && (
                                        <button onClick={() => setCatalogSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                            <X size={16} />
                                        </button>
                                    )}
                                </div>

                                {/* Search Results */}
                                {catalogSearch.trim() && (
                                    <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                                        {isSearchingCatalog ? (
                                            <div className="p-4 flex justify-center text-gray-400">
                                                <Loader2 className="animate-spin w-5 h-5" />
                                            </div>
                                        ) : catalogResults.length === 0 ? (
                                            <div className="p-4 text-center text-gray-500 text-sm">No results found</div>
                                        ) : (
                                            <div className="divide-y divide-gray-100">
                                                {catalogResults.map(item => {
                                                    const isSelected = selectedCatalogIds.has(item.id);
                                                    return (
                                                        <label
                                                            key={item.id}
                                                            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${isSelected ? 'bg-purple-50/50' : 'hover:bg-gray-50'}`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => toggleCatalogItem(item.id, item)}
                                                                className="w-4 h-4 rounded border-gray-300 text-[#4b2192] focus:ring-[#4b2192]/20 shrink-0"
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-semibold text-gray-900 text-sm truncate">{item.name}</div>
                                                                <div className="text-xs text-gray-400">{item.partnerCode} • {item.type}</div>
                                                            </div>
                                                            <div className="text-sm font-bold text-gray-700 shrink-0">₹{item.displayPrice}</div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Selected items list */}
                                {selectedItemsMap.size > 0 && (
                                    <div className="mt-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Selected ({selectedItemsMap.size})</span>
                                            <button
                                                onClick={() => { setSelectedCatalogIds(new Set()); setSelectedItemsMap(new Map()); }}
                                                className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors"
                                            >
                                                Clear all
                                            </button>
                                        </div>
                                        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-40 overflow-y-auto">
                                            {Array.from(selectedItemsMap.entries()).map(([id, item]) => (
                                                <div key={id} className="flex items-center justify-between px-3 py-2 group hover:bg-gray-50/50 transition-colors">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Package size={14} className="text-purple-400 shrink-0" />
                                                        <span className="text-sm font-medium text-gray-800 truncate">{item.name}</span>
                                                        <span className="text-xs text-gray-400 shrink-0">• {item.type}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => toggleCatalogItem(id)}
                                                        className="p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                                                        title="Remove"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-gray-200 bg-white flex items-center justify-end gap-3">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={isSaving}
                                className="bg-[#4b2192] text-white px-6 py-2.5 rounded-xl font-medium hover:bg-[#3d1a7a] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95"
                            >
                                {isSaving && <Loader2 size={16} className="animate-spin" />}
                                {editingCamp ? 'Update Camp' : 'Create Camp'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Update Items Modal */}
            {isItemsModalOpen && itemsEditCamp && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900">Update Camp Items</h2>
                                <p className="text-sm text-gray-500 mt-0.5">{itemsEditCamp.name}</p>
                            </div>
                            <button
                                onClick={() => setIsItemsModalOpen(false)}
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
                                    placeholder="Search tests or packages..."
                                    value={itemsCatalogSearch}
                                    onChange={(e) => setItemsCatalogSearch(e.target.value)}
                                    autoFocus
                                    className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                                />
                                {itemsCatalogSearch && (
                                    <button onClick={() => setItemsCatalogSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                        <X size={16} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0">
                            {isSearchingItemsCatalog ? (
                                <div className="p-12 flex justify-center text-gray-400">
                                    <Loader2 className="animate-spin w-6 h-6" />
                                </div>
                            ) : itemsCatalogResults.length === 0 && itemsCatalogSearch.trim() ? (
                                <div className="p-12 text-center text-gray-500 text-sm">
                                    No items found matching your search.
                                </div>
                            ) : !itemsCatalogSearch.trim() ? (
                                <div className="p-8 text-center text-gray-400 text-sm">
                                    Search for tests or packages to add to this camp.
                                    <div className="mt-2 text-xs">{itemsSelectedIds.size} item{itemsSelectedIds.size !== 1 ? 's' : ''} currently selected</div>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {itemsCatalogResults.map(item => {
                                        const isSelected = itemsSelectedIds.has(item.id);
                                        return (
                                            <label
                                                key={item.id}
                                                className={`flex items-center gap-4 px-6 py-3.5 cursor-pointer transition-colors ${isSelected ? 'bg-purple-50/50' : 'hover:bg-gray-50'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleItemsCatalogItem(item.id)}
                                                    className="w-4 h-4 rounded border-gray-300 text-[#4b2192] focus:ring-[#4b2192]/20 shrink-0"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-semibold text-gray-900 text-sm truncate">{item.name}</div>
                                                    <div className="text-xs text-gray-400 mt-0.5">{item.partnerCode} • {item.type}</div>
                                                </div>
                                                <div className="text-sm font-bold text-gray-700 shrink-0">₹{item.displayPrice}</div>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-gray-200 bg-white flex items-center justify-between">
                            <span className="text-sm text-gray-500">
                                {itemsSelectedIds.size > 0 ? `${itemsSelectedIds.size} selected` : 'Select items'}
                            </span>
                            <button
                                onClick={handleSaveItems}
                                disabled={isSavingItems}
                                className="bg-[#4b2192] text-white px-6 py-2.5 rounded-xl font-medium hover:bg-[#3d1a7a] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95"
                            >
                                {isSavingItems ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
                                Save Items
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
