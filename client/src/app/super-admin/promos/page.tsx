'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Tag, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface PromoCode {
    id: string;
    code: string;
    description: string;
    discountType: 'PERCENTAGE' | 'FLAT';
    discountValue: number;
    maxDiscount?: number;
    isActive: boolean;
    redeemedCount: number;
    maxRedemptions?: number;
    expiresAt?: string;
}

export default function PromosPage() {
    const [promos, setPromos] = useState<PromoCode[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');

    const fetchPromos = async () => {
        setIsLoading(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const query = search ? `?search=${search}` : '';
            const res = await fetch(`/api/admin/promos${query}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setPromos(data.promos || []);
            }
        } catch (error) {
            console.error('Failed to fetch promos', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const timeout = setTimeout(fetchPromos, 300); // Debounce
        return () => clearTimeout(timeout);
    }, [search]);

    const toggleStatus = async (id: string, currentStatus: boolean) => {
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch(`/api/admin/promos/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ isActive: !currentStatus })
            });
            if (res.ok) {
                fetchPromos();
            }
        } catch (error) {
            console.error('Failed to toggle status', error);
        }
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Tag className="w-6 h-6 text-primary" /> Promo Codes
                    </h1>
                    <p className="text-gray-500 mt-1">Create and manage discount coupons</p>
                </div>
                <Link href="/super-admin/promos/new">
                    <button className="bg-[#4b2192] text-white px-5 py-2.5 rounded-xl flex items-center gap-2 font-medium hover:bg-[#3d1a7a] transition-all shadow-lg shadow-purple-900/10 active:scale-95">
                        <Plus size={18} /> Create New Promo
                    </button>
                </Link>
            </div>

            {/* Search */}
            <div className="mb-6 relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Search by code..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all"
                />
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {isLoading ? (
                    <div className="p-12 flex justify-center text-gray-400">
                        <Loader2 className="animate-spin w-8 h-8" />
                    </div>
                ) : promos.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        No promo codes found. Create one to get started.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50/50 text-gray-500 font-medium text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="px-6 py-4">Code</th>
                                    <th className="px-6 py-4">Discount</th>
                                    <th className="px-6 py-4">Redeemed</th>
                                    <th className="px-6 py-4">Expiry</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {promos.map(promo => (
                                    <tr key={promo.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-gray-900">{promo.code}</div>
                                            <div className="text-xs text-gray-400 truncate max-w-[200px]">{promo.description}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium text-sm">
                                                {promo.discountType === 'PERCENTAGE' ? `${promo.discountValue}%` : `₹${promo.discountValue}`} OFF
                                            </div>
                                            {promo.maxDiscount && (
                                                <div className="text-xs text-gray-400 mt-1">Max ₹{promo.maxDiscount}</div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600">
                                            <span className="font-medium text-gray-900">{promo.redeemedCount}</span>
                                            {promo.maxRedemptions && <span className="text-gray-400"> / {promo.maxRedemptions}</span>}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600">
                                            {promo.expiresAt ? new Date(promo.expiresAt).toLocaleDateString() : 'Never'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => toggleStatus(promo.id, promo.isActive)}
                                                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${promo.isActive
                                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {promo.isActive ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {promo.isActive ? 'Active' : 'Inactive'}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {/* Edit Button Could Go Here */}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
