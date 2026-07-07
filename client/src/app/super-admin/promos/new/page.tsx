'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// --- Zod schema ---

/** Handles optional numeric inputs from HTML (empty string → undefined). */
const optionalPositiveNumber = z
    .union([z.coerce.number().positive(), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : v));

const optionalNonNegativeNumber = z
    .union([z.coerce.number().min(0), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : v));

const optionalPositiveInt = z
    .union([z.coerce.number().int().positive(), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : v));

const promoSchema = z.object({
    code: z
        .string()
        .min(1, 'Promo code is required')
        .transform((v) => v.toUpperCase()),
    description: z.string().optional(),
    discountType: z.enum(['PERCENTAGE', 'FLAT']),
    discountValue: z.coerce.number({ error: 'Discount value is required' }).positive('Must be a positive number'),
    maxDiscount: optionalNonNegativeNumber,
    minOrderValue: optionalNonNegativeNumber,
    maxRedemptions: optionalPositiveInt,
    maxPerUser: z.coerce.number().int().positive('Must be at least 1').default(1),
    startsAt: z.string().min(1, 'Start date is required'),
    expiresAt: z.union([z.string().min(1), z.literal('')]).optional().transform((v) => (v === '' ? undefined : v)),
    isActive: z.boolean().default(true),
});

type PromoFormData = z.input<typeof promoSchema>;

export default function NewPromoPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const {
        register,
        handleSubmit,
        watch,
        formState: { errors },
    } = useForm<PromoFormData>({
        resolver: zodResolver(promoSchema),
        defaultValues: {
            code: '',
            description: '',
            discountType: 'PERCENTAGE',
            discountValue: '' as unknown as number,
            maxDiscount: '',
            minOrderValue: '',
            maxRedemptions: '',
            maxPerUser: '1' as unknown as number,
            startsAt: new Date().toISOString().split('T')[0],
            expiresAt: '',
            isActive: true,
        },
    });

    const discountType = watch('discountType');

    const onSubmit = async (data: PromoFormData) => {
        setLoading(true);

        try {
            await api.post('/admin/promos', data);
            toast.success('Promo created successfully');
            router.push('/super-admin/promos');
        } catch (error: any) {
            console.error('Failed to create promo:', error);
            toast.error(error.response?.data?.error || 'Failed to create promo');
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

            <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* Basic Info */}
                    <div className="space-y-6">
                        <h2 className="text-lg font-semibold text-gray-900 border-b pb-2">Basic Information</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Promo Code <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                {...register('code')}
                                placeholder="e.g. SUMMER25"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] uppercase"
                            />
                            {errors.code ? (
                                <p className="text-xs text-red-500 mt-1">{errors.code.message}</p>
                            ) : (
                                <p className="text-xs text-gray-400 mt-1">Will be converted to uppercase automatically</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                            <textarea
                                {...register('description')}
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
                                    {...register('discountType')}
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
                                    {...register('discountValue')}
                                    placeholder="e.g. 20"
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                    min="0"
                                />
                                {errors.discountValue && (
                                    <p className="text-xs text-red-500 mt-1">{errors.discountValue.message}</p>
                                )}
                            </div>
                        </div>

                        {discountType === 'PERCENTAGE' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Max Discount Amount (₹)</label>
                                <input
                                    type="number"
                                    {...register('maxDiscount')}
                                    placeholder="e.g. 1000"
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                    min="0"
                                />
                                {errors.maxDiscount && (
                                    <p className="text-xs text-red-500 mt-1">{errors.maxDiscount.message}</p>
                                )}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Min Order Value (₹)</label>
                            <input
                                type="number"
                                {...register('minOrderValue')}
                                placeholder="e.g. 500"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                min="0"
                            />
                            {errors.minOrderValue && (
                                <p className="text-xs text-red-500 mt-1">{errors.minOrderValue.message}</p>
                            )}
                        </div>
                    </div>

                    {/* Limits & Validity */}
                    <div className="space-y-6">
                        <h2 className="text-lg font-semibold text-gray-900 border-b pb-2">Limits & Validity</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max Redemptions (Total)</label>
                            <input
                                type="number"
                                {...register('maxRedemptions')}
                                placeholder="Leave empty for unlimited"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                min="0"
                            />
                            {errors.maxRedemptions && (
                                <p className="text-xs text-red-500 mt-1">{errors.maxRedemptions.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max Uses Per User</label>
                            <input
                                type="number"
                                {...register('maxPerUser')}
                                placeholder="1"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                min="1"
                            />
                            {errors.maxPerUser && (
                                <p className="text-xs text-red-500 mt-1">{errors.maxPerUser.message}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-1">How many times each user can use this code</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Starts At</label>
                                <input
                                    type="date"
                                    {...register('startsAt')}
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                />
                                {errors.startsAt && (
                                    <p className="text-xs text-red-500 mt-1">{errors.startsAt.message}</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Expires At</label>
                                <input
                                    type="date"
                                    {...register('expiresAt')}
                                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192]"
                                />
                                {errors.expiresAt && (
                                    <p className="text-xs text-red-500 mt-1">{errors.expiresAt.message}</p>
                                )}
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
