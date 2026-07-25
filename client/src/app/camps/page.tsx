'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, MapPin, Sparkles } from 'lucide-react';
import api from '@/lib/api';
import { CampCard, type ActiveCamp } from '@/components/camps/CampCard';

export default function CampsListingPage() {
    const [camps, setCamps] = useState<ActiveCamp[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchCamps = useCallback(async () => {
        try {
            const res = await api.get('/camps/active');
            setCamps(res.data.camps || res.data || []);
        } catch (error) {
            console.error('Failed to fetch camps:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchCamps(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="w-full min-h-screen bg-gray-50">
            {/* ═══ Page Header ═══ */}
            <div className="relative bg-gradient-to-br from-[#3a1278] via-[#4b2192] to-[#7c3aed] text-white overflow-hidden">
                {/* Decorative */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/[0.03] rounded-full" />
                    <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-white/[0.02] rounded-full translate-y-1/2" />
                </div>

                <div className="relative container mx-auto px-4 py-10 sm:py-14 max-w-6xl text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 mb-5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                        <span className="text-xs sm:text-sm font-bold text-white/90 uppercase tracking-wide">Walk-in Health Checkups</span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-black mb-3 leading-tight">
                        Health Camps Near You
                    </h1>
                    <p className="text-base sm:text-lg text-white/60 font-medium max-w-xl mx-auto">
                        Affordable walk-in health checkups at a location near you — no home visit needed
                    </p>
                </div>
            </div>

            {/* ═══ Content ═══ */}
            <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 max-w-6xl">
                {isLoading ? (
                    <CampsSkeleton />
                ) : camps.length === 0 ? (
                    <EmptyState />
                ) : (
                    <>
                        {/* Count */}
                        <div className="flex items-center justify-between mb-5 sm:mb-7">
                            <p className="text-sm text-gray-500 font-medium">
                                <span className="text-gray-900 font-bold">{camps.length}</span> active camp{camps.length !== 1 ? 's' : ''} available
                            </p>
                        </div>

                        {/* Card grid */}
                        <div className="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {camps.map(camp => (
                                <CampCard key={camp.id} camp={camp} />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Empty State ─────────────────────────────────────
function EmptyState() {
    return (
        <div className="text-center py-16 sm:py-24">
            <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <MapPin className="w-7 h-7 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">No Active Camps</h2>
            <p className="text-gray-500 max-w-md mx-auto mb-6">
                There are no health camps available right now. Check back soon — we regularly add new camps in your area.
            </p>
        </div>
    );
}

// ── Skeleton ────────────────────────────────────────
function CampsSkeleton() {
    return (
        <>
            <div className="flex items-center justify-between mb-5 sm:mb-7">
                <div className="h-5 w-40 bg-gray-100 rounded-lg animate-pulse" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="bg-white rounded-2xl sm:rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="bg-gradient-to-br from-gray-200 to-gray-100 px-5 py-4 sm:px-6 sm:py-5 space-y-3">
                            <div className="h-5 w-20 bg-white/40 rounded-full animate-pulse" />
                            <div className="h-6 w-3/4 bg-white/30 rounded-lg animate-pulse" />
                            <div className="h-4 w-1/2 bg-white/20 rounded animate-pulse" />
                        </div>
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
