'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight, Calendar, Heart, Loader2, MapPin, Sparkles, TestTubes, Users } from 'lucide-react';
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

// ─── Helpers ──────────────────────────────────────────
function getCampStatus(start: string, end: string): { label: string; color: string; dot: string } {
    const now = new Date();
    const s = new Date(start);
    const e = new Date(end);

    if (now >= s && now <= e) {
        return { label: 'Happening Now', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
    }
    const diff = Math.ceil((s.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= 3) {
        return { label: `Starts in ${diff}d`, color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
    }
    return { label: 'Upcoming', color: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500' };
}

function formatDateShort(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatDateFull(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Main Component ────────────────────────────────────
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

// ─── Camp Card ─────────────────────────────────────────
function CampCard({ camp }: { camp: ActiveCamp }) {
    const status = getCampStatus(camp.startDate, camp.endDate);
    const testCount = camp._count?.items ?? 0;

    return (
        <Link
            href={`/camps/${camp.id}`}
            className="group relative flex flex-col bg-white rounded-2xl sm:rounded-3xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-xl hover:border-purple-200/60 transition-all duration-300 hover:-translate-y-1"
        >
            {/* ── Gradient Header ── */}
            <div className="relative bg-gradient-to-br from-[#4b2192] via-[#5b2db0] to-[#7c3aed] px-5 py-4 sm:px-6 sm:py-5">
                {/* Decorative circles */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-white/[0.04] rounded-full -translate-y-8 translate-x-8" />
                <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/[0.04] rounded-full translate-y-6 -translate-x-4" />

                <div className="relative z-10">
                    {/* Status badge */}
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide border ${status.color} mb-3`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${status.label === 'Happening Now' ? 'animate-pulse' : ''}`} />
                        {status.label}
                    </div>

                    {/* Camp name */}
                    <h3 className="text-white font-bold text-lg sm:text-xl leading-tight mb-1 line-clamp-2">
                        {camp.name}
                    </h3>

                    {/* Location */}
                    <div className="flex items-center gap-1.5 text-white/70 text-sm">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{camp.location}, {camp.city}</span>
                    </div>
                </div>
            </div>

            {/* ── Card Body ── */}
            <div className="flex flex-col flex-1 p-5 sm:p-6">
                {/* Description */}
                {camp.description && (
                    <p className="text-sm text-gray-500 leading-relaxed mb-4 line-clamp-2">{camp.description}</p>
                )}

                {/* Info chips */}
                <div className="flex flex-wrap gap-2 mb-5">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 text-xs font-semibold text-gray-600">
                        <Calendar className="w-3.5 h-3.5 text-gray-400" />
                        {formatDateShort(camp.startDate)} — {formatDateFull(camp.endDate)}
                    </div>
                    {testCount > 0 && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 text-xs font-semibold text-purple-600">
                            <TestTubes className="w-3.5 h-3.5" />
                            {testCount} tests included
                        </div>
                    )}
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Price + CTA Row */}
                <div className="flex items-end justify-between pt-4 border-t border-gray-100">
                    <div>
                        <div className="text-[10px] sm:text-xs text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Starting at</div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl sm:text-3xl font-extrabold text-gray-900">₹{camp.price.toLocaleString('en-IN')}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 bg-[#4b2192] text-white pl-5 pr-4 py-2.5 sm:py-3 rounded-xl font-semibold text-sm group-hover:bg-[#3a1875] transition-all shadow-lg shadow-purple-900/15 active:scale-95">
                        Register
                        <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                    </div>
                </div>
            </div>
        </Link>
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
