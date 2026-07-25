'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import api from '@/lib/api';
import { CampCard, type ActiveCamp } from '@/components/camps/CampCard';

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

    if (loading) return <CampsSkeleton />;
    if (camps.length === 0) return null;

    const displayCamps = camps.slice(0, 6);
    const showViewAll = camps.length > 3;

    return (
        <>
            <SectionHeader />

            {/* Mobile: Full-width stacked cards | Desktop: 3-col grid */}
            <div className="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {displayCamps.map(camp => (
                    <CampCard key={camp.id} camp={camp} />
                ))}
            </div>

            {showViewAll && (
                <div className="mt-10 sm:mt-14 text-center">
                    <Link
                        href="/camps"
                        className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl border-2 border-purple-200 text-purple-700 font-bold text-sm hover:bg-purple-50 hover:border-purple-300 transition-all active:scale-[0.97]"
                    >
                        View All Health Camps
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Link>
                </div>
            )}
        </>
    );
}

// ─── Section Header ─────────────────────────────────────
function SectionHeader() {
    return (
        <div className="text-center mb-10 sm:mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-100/80 mb-5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-xs sm:text-sm font-bold text-purple-700 uppercase tracking-wide">Walk-in Health Checkups</span>
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-5xl font-black text-gray-900 mb-3 sm:mb-4">
                Health Camps Near You
            </h2>
            <p className="text-base sm:text-lg text-gray-500 font-medium max-w-xl sm:max-w-2xl mx-auto px-4 sm:px-0">
                Affordable walk-in health checkups at a location near you — no home visit needed
            </p>
        </div>
    );
}

// ─── Loading Skeleton ───────────────────────────────────
function CampsSkeleton() {
    return (
        <>
            {/* Header skeleton */}
            <div className="text-center mb-10 sm:mb-14">
                <div className="h-7 w-48 bg-gray-100 rounded-full mx-auto mb-5 animate-pulse" />
                <div className="h-10 w-72 sm:w-96 bg-gray-100 rounded-xl mx-auto mb-3 animate-pulse" />
                <div className="h-5 w-64 sm:w-80 bg-gray-50 rounded-lg mx-auto animate-pulse" />
            </div>

            {/* Card skeletons */}
            <div className="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map(i => (
                    <div key={i} className="bg-white rounded-2xl sm:rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                        {/* Header skeleton */}
                        <div className="bg-gradient-to-br from-gray-200 to-gray-100 px-5 py-4 sm:px-6 sm:py-5 space-y-3">
                            <div className="h-5 w-20 bg-white/40 rounded-full animate-pulse" />
                            <div className="h-6 w-3/4 bg-white/30 rounded-lg animate-pulse" />
                            <div className="h-4 w-1/2 bg-white/20 rounded animate-pulse" />
                        </div>
                        {/* Body skeleton */}
                        <div className="p-5 sm:p-6 space-y-4">
                            <div className="flex gap-2">
                                <div className="h-7 w-36 bg-gray-100 rounded-lg animate-pulse" />
                                <div className="h-7 w-28 bg-gray-100 rounded-lg animate-pulse" />
                            </div>
                            <div className="pt-4 border-t border-gray-100 flex justify-between items-end">
                                <div>
                                    <div className="h-3 w-14 bg-gray-100 rounded animate-pulse mb-1.5" />
                                    <div className="h-8 w-20 bg-gray-200 rounded-lg animate-pulse" />
                                </div>
                                <div className="h-11 w-28 bg-gray-200 rounded-xl animate-pulse" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
}
