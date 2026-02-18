'use client';

import { useState, useEffect } from 'react';
import {
    Plus,
    Edit,
    Trash2,
    Tag,
    Loader2,
    X,
    Check,
} from 'lucide-react';

interface Category {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isActive: boolean;
    itemCount: number;
    enabledItemCount: number;
    items: { catalogItem: { id: string; name: string; isEnabled: boolean } }[];
}

interface CatalogItemOption {
    id: string;
    name: string;
    isEnabled: boolean;
}

export default function CategoryManagement() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [allItems, setAllItems] = useState<CatalogItemOption[]>([]);
    const [loading, setLoading] = useState(true);

    // Create dialog
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [newSlug, setNewSlug] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [creating, setCreating] = useState(false);

    // Assign dialog
    const [showAssign, setShowAssign] = useState(false);
    const [assignCatId, setAssignCatId] = useState('');
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [assigning, setAssigning] = useState(false);

    const token = typeof window !== 'undefined' ? localStorage.getItem('docnow_auth_token') : null;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [catRes, itemRes] = await Promise.all([
                fetch('/api/manager/categories', { headers }),
                fetch('/api/manager/catalog?limit=9999', { headers }),
            ]);
            if (catRes.ok) { const data = await catRes.json(); setCategories(data); }
            if (itemRes.ok) {
                const data = await itemRes.json();
                setAllItems((data.items || []).map((i: any) => ({ id: i.id, name: i.name, isEnabled: i.isEnabled })));
            }
        } catch { /* ignore */ }
        setLoading(false);
    };

    const generateSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const handleCreate = async () => {
        if (!newName.trim()) { alert('Name is required'); return; }
        setCreating(true);
        try {
            const res = await fetch('/api/manager/categories', {
                method: 'POST', headers,
                body: JSON.stringify({ name: newName, description: newDesc || undefined }),
            });
            if (res.ok) {
                setShowCreate(false); setNewName(''); setNewSlug(''); setNewDesc('');
                fetchData();
            } else {
                const err = await res.json(); alert(err.error || 'Failed');
            }
        } catch { alert('Network error'); }
        setCreating(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this category?')) return;
        try {
            await fetch(`/api/manager/categories/${id}`, { method: 'DELETE', headers });
            fetchData();
        } catch { /* ignore */ }
    };

    const handleAssign = async () => {
        if (!assignCatId || selectedItems.length === 0) { alert('Select a category and at least one product'); return; }
        setAssigning(true);
        try {
            const res = await fetch(`/api/manager/categories/${assignCatId}/items`, {
                method: 'POST', headers,
                body: JSON.stringify({ itemIds: selectedItems }),
            });
            if (res.ok) {
                setShowAssign(false); setAssignCatId(''); setSelectedItems([]);
                fetchData();
            } else {
                const err = await res.json(); alert(err.error || 'Failed');
            }
        } catch { alert('Network error'); }
        setAssigning(false);
    };

    const toggleItem = (id: string) => {
        setSelectedItems(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">Category Management</h1>
                    <p className="text-gray-600 mt-1">Organize products into categories</p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium w-full sm:w-auto"
                    style={{ backgroundColor: '#4b2192' }}
                >
                    <Plus className="h-4 w-4" />
                    Create Category
                </button>
            </div>

            {/* Categories Grid */}
            {categories.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
                    No categories yet. Create one to get started.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {categories.map((cat) => (
                        <div key={cat.id} className="bg-white rounded-xl shadow-sm border border-gray-200">
                            <div className="p-5">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#4b219215' }}>
                                            <Tag className="h-5 w-5" style={{ color: '#4b2192' }} />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                                            <p className="text-sm text-gray-500">{cat.slug}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cat.isActive !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                        {cat.isActive !== false ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                            </div>
                            <div className="px-5 pb-5">
                                {cat.description && <p className="text-sm text-gray-600 mb-4">{cat.description}</p>}
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-500">
                                        {cat.itemCount} items · {cat.enabledItemCount} enabled
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleDelete(cat.id)}
                                            className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-300 text-red-500 hover:bg-red-50"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Assign Products Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h2 className="font-semibold text-gray-900">Assign Products to Categories</h2>
                        <p className="text-sm text-gray-500 mt-1">Organize products by selecting a category</p>
                    </div>
                    <button
                        onClick={() => setShowAssign(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50"
                    >
                        <Plus className="h-4 w-4" />
                        Assign Products
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left">
                                <th className="px-6 py-3 font-medium text-gray-500">Category</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Slug</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Items</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {categories.map((cat, index) => (
                                <tr key={cat.id} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-gray-50/50' : ''}`}>
                                    <td className="px-6 py-3 font-medium text-gray-900">{cat.name}</td>
                                    <td className="px-6 py-3 text-gray-500">{cat.slug}</td>
                                    <td className="px-6 py-3">
                                        <span className="px-2 py-0.5 rounded-full border text-xs font-medium text-gray-700 border-gray-300">
                                            {cat.itemCount} items
                                        </span>
                                    </td>
                                    <td className="px-6 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cat.isActive !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                            {cat.isActive !== false ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Category Modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Create New Category</h3>
                                <p className="text-sm text-gray-500">Add a new category to organize your products</p>
                            </div>
                            <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-gray-700 block mb-1">Category Name *</label>
                                <input
                                    value={newName}
                                    onChange={(e) => { setNewName(e.target.value); setNewSlug(generateSlug(e.target.value)); }}
                                    placeholder="e.g., Blood Tests"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700 block mb-1">Slug *</label>
                                <input
                                    value={newSlug}
                                    onChange={(e) => setNewSlug(e.target.value)}
                                    placeholder="blood-tests"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                                <p className="text-xs text-gray-500 mt-1">Auto-generated from name</p>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700 block mb-1">Description</label>
                                <textarea
                                    value={newDesc}
                                    onChange={(e) => setNewDesc(e.target.value)}
                                    placeholder="Brief description..."
                                    rows={3}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6 justify-end">
                            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={creating}
                                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60"
                                style={{ backgroundColor: '#4b2192' }}
                            >
                                {creating ? 'Creating...' : 'Create Category'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Assign Products Modal */}
            {showAssign && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Assign Products to Category</h3>
                                <p className="text-sm text-gray-500">Select a category and choose products</p>
                            </div>
                            <button onClick={() => setShowAssign(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-gray-700 block mb-1">Select Category</label>
                                <select
                                    value={assignCatId}
                                    onChange={(e) => setAssignCatId(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                >
                                    <option value="">Choose a category</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700 block mb-1">Select Products</label>
                                <div className="border border-gray-300 rounded-lg p-3 max-h-52 overflow-y-auto space-y-2">
                                    {allItems.map(item => (
                                        <label key={item.id} className="flex items-center gap-2 cursor-pointer py-1">
                                            <input
                                                type="checkbox"
                                                checked={selectedItems.includes(item.id)}
                                                onChange={() => toggleItem(item.id)}
                                                className="rounded border-gray-300"
                                            />
                                            <span className="text-sm">{item.name}</span>
                                            {!item.isEnabled && <span className="text-xs text-gray-400">(disabled)</span>}
                                        </label>
                                    ))}
                                    {allItems.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No products available. Sync from Healthians first.</p>}
                                </div>
                                <p className="text-xs text-gray-500 mt-1">{selectedItems.length} product(s) selected</p>
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6 justify-end">
                            <button onClick={() => setShowAssign(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
                                Cancel
                            </button>
                            <button
                                onClick={handleAssign}
                                disabled={assigning}
                                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60"
                                style={{ backgroundColor: '#4b2192' }}
                            >
                                {assigning ? 'Assigning...' : 'Assign Products'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
