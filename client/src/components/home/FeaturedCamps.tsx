'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight, Calendar, Heart, Loader2, MapPin, TestTubes } from 'lucide-react';
import { Button } from '@/components/ui';
import api from '@/lib/api';

interface ActiveCamp {
    id: string;
    name: string;
    description: string | null;
    location: string;
    city: string;
    startDate: string;
    endDate: string;
    price: number;
    _count?: {
        items: number;
    };
}

function isNetworkError(error: unknown) {
    return typeof error === 'object' && error !== null && 'isNetworkError' in error;
}

/**
 * Homepage client island — "Health Camps Near You"
 *
 * Returns `null` when no active camps exist so the entire
 * section silently disappears from the homepage.
 */
export function FeaturedCamps() {
    const [camps, setCamps] = useState<ActiveCamp[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchCamps = useCallback(async (retries = 2) => {
        try {
            const res = await api.get('/camps/active');
            setCamps(res.data.camps || res.data || []);
        } catch (err: unknown) {
            if (retries > 0 && isNetworkError(err)) {
                await new Promise(r => setTimeout(r, 1500));
                return fetchCamps(retries - 1);
            }
            console.warn('[Home] Could not load camps:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchCamps(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    const formatDateFull = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    // Loading skeleton — compact horizontal cards
    if (loading) {
        return (
            <>
                <SectionHeader />
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="h-1.5 bg-gray-200 animate-pulse" />
                            <div className="p-5 sm:p-6 space-y-4">
                                <div className="h-6 w-3/4 bg-gray-200 rounded animate-pulse" />
                                <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                                <div className="space-y-2.5">
                                    <div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse" />
                                    <div className="h-4 w-1/2 bg-gray-100 rounded animate-pulse" />
                                </div>
                                <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
                                    <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
                                    <div className="h-10 w-32 bg-gray-200 rounded-xl animate-pulse" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </>
        );
    }

    // No camps — silently hide the entire section
    if (camps.length === 0) return null;

    return (
        <>
            <SectionHeader />
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {camps.slice(0, 6).map(camp => (
                    <Link
                        key={camp.id}
                        href={`/camps/${camp.id}`}
                        className="group bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-lg hover:border-purple-100 transition-all duration-300 hover:-translate-y-1"
                    >
                        {/* Card Top Accent */}
                        <div className="h-1.5 bg-gradient-to-r from-[#4b2192] to-[#7c3aed]" />

                        <div className="p-5 sm:p-6">
                            <h3 className="text-lg font-bold text-gray-900 mb-1.5 group-hover:text-[#4b2192] transition-colors">
                                {camp.name}
                            </h3>
                            {camp.description && (
                                <p className="text-sm text-gray-500 mb-4 line-clamp-2">{camp.description}</p>
                            )}

                            <div className="space-y-2.5 mb-5">
                                <div className="flex items-center gap-2.5 text-sm text-gray-600">
                                    <MapPin size={16} className="text-gray-400 shrink-0" />
                                    <span className="truncate">{camp.location}, {camp.city}</span>
                                </div>
                                <div className="flex items-center gap-2.5 text-sm text-gray-600">
                                    <Calendar size={16} className="text-gray-400 shrink-0" />
                                    <span>{formatDate(camp.startDate)} — {formatDateFull(camp.endDate)}</span>
                                </div>
                                <div className="flex items-center gap-2.5 text-sm text-gray-600">
                                    <TestTubes size={16} className="text-gray-400 shrink-0" />
                                    <span>{camp._count?.items ?? 0} tests & packages included</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                <div>
                                    <div className="text-xs text-gray-400 font-medium uppercase tracking-wider">Camp Price</div>
                                    <div className="text-2xl font-bold text-gray-900">₹{camp.price}</div>
                                </div>
                                <div className="bg-[#4b2192] text-white px-5 py-2.5 rounded-xl flex items-center gap-2 font-medium group-hover:bg-[#3d1a7a] transition-all shadow-lg shadow-purple-900/10 active:scale-95 text-sm">
                                    Register Now <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>

            <div className="mt-12 text-center">
                <Button
                    variant="outline"
                    size="lg"
                    onClick={() => window.location.href = '/camps'}
                    className="border-purple-200 text-purple-700 hover:bg-purple-50"
                >
                    View All Health Camps
                    <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
            </div>
        </>
    );
}

function SectionHeader() {
    return (
        <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-50 border border-purple-100 mb-4">
                <Heart className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-bold text-purple-700">Walk-in Health Checkups</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-gray-900 mb-4">
                Health Camps Near You
            </h2>
            <p className="text-lg text-gray-500 font-medium max-w-2xl mx-auto">
                Affordable walk-in health checkups at a location near you — no home visit needed
            </p>
        </div>
    );
}
