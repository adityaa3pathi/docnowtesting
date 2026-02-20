'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function NewPromoPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        code: '',
        description: '',
        discountType: 'PERCENTAGE',
        discountValue: '',
        maxDiscount: '',
        minOrderValue: '',
        maxRedemptions: '',
        maxPerUser: '1',
        startsAt: new Date().toISOString().split('T')[0],
        expiresAt: '',
        isActive: true
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        if (type === 'checkbox') {
            setFormData(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const token = localStorage.getItem('docnow_auth_token');
            const res = await fetch('/api/admin/promos', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                toast.success('Promo created successfully');
                router.push('/super-admin/promos');
            } else {
                const data = await res.json();
                toast.error(data.error || 'Failed to create promo');
            }
        } catch (error) {
            console.error('Failed to create promo:', error);
            toast.error('Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-[1000px] mx-auto">
            <div className="mb-8">
                <Link href="/super-admin/promos" className="text-gray-500 hover:text-gray-700 flex items-center gap-2 mb-4 transition-colors">
                    <ArrowLeft size={18} /> Back to Promos
                </Link>
                <h1 className="text-2xl font-bold text-gray-900">Create New Promo Code</h1>
                <p className="text-gray-500 mt-1">Configure discount rules and limitations</p>
            </div>

            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* Basic Info */}
                    <div className="space-y-6">
                        <h2 className="text-lg font-semibold text-gray-900 border-b pb-2">Basic Information</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Promo Code <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                name="code"
                                value={formData.code}
                                onChange={handleChange}
                                placeholder="e.g. SUMMER25"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] uppercase"
                                required
                            />
                            <p className="text-xs text-gray-400 mt-1">Will be converted to uppercase automatically</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                placeholder="Internal note or user-facing description"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] h-24 resize-none"
                            />
                        </div>
                    </div>

                    {/* Discount Rules */}
                    <div className="space-y-6">
                        <h2 className="text-lg font-semibold text-gray-900 border-b pb-2">Discount Rules</h2>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Type <span className="text-red-500">*</span></label>
                                <select
                                    name="discountType"
                                    value={formData.discountType}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                >
                                    <option value="PERCENTAGE">Percentage (%)</option>
                                    <option value="FLAT">Flat Amount (₹)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Value <span className="text-red-500">*</span></label>
                                <input
                                    type="number"
                                    name="discountValue"
                                    value={formData.discountValue}
                                    onChange={handleChange}
                                    placeholder="e.g. 20"
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                    required
                                    min="0"
                                />
                            </div>
                        </div>

                        {formData.discountType === 'PERCENTAGE' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Max Discount Amount (₹)</label>
                                <input
                                    type="number"
                                    name="maxDiscount"
                                    value={formData.maxDiscount}
                                    onChange={handleChange}
                                    placeholder="e.g. 1000"
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                    min="0"
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Min Order Value (₹)</label>
                            <input
                                type="number"
                                name="minOrderValue"
                                value={formData.minOrderValue}
                                onChange={handleChange}
                                placeholder="e.g. 500"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                min="0"
                            />
                        </div>
                    </div>

                    {/* Limits & Validity */}
                    <div className="space-y-6">
                        <h2 className="text-lg font-semibold text-gray-900 border-b pb-2">Limits & Validity</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max Redemptions (Total)</label>
                            <input
                                type="number"
                                name="maxRedemptions"
                                value={formData.maxRedemptions}
                                onChange={handleChange}
                                placeholder="Leave empty for unlimited"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                min="0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max Uses Per User</label>
                            <input
                                type="number"
                                name="maxPerUser"
                                value={formData.maxPerUser}
                                onChange={handleChange}
                                placeholder="1"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                min="1"
                            />
                            <p className="text-xs text-gray-400 mt-1">How many times each user can use this code</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Starts At</label>
                                <input
                                    type="date"
                                    name="startsAt"
                                    value={formData.startsAt}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Expires At</label>
                                <input
                                    type="date"
                                    name="expiresAt"
                                    value={formData.expiresAt}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-10 flex justify-end gap-4 border-t pt-6">
                    <Link href="/super-admin/promos">
                        <button type="button" className="px-6 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors">
                            Cancel
                        </button>
                    </Link>
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-[#4b2192] text-white px-8 py-2.5 rounded-xl font-medium hover:bg-[#3d1a7a] transition-all shadow-lg shadow-purple-900/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                        Create Promo Code
                    </button>
                </div>
            </form>
        </div>
    );
}
