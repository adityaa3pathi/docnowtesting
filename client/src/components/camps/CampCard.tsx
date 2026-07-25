/**
 * Shared Camp Card Component
 * 
 * Used on both the homepage (FeaturedCamps) and /camps listing page.
 * Renders a premium card with gradient header, status badge, and info chips.
 */

import Link from 'next/link';
import { ArrowRight, Calendar, MapPin, TestTubes } from 'lucide-react';

// ── Shared Types ────────────────────────────────────
export interface ActiveCamp {
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

// ── Helpers ─────────────────────────────────────────
export function getCampStatus(start: string, end: string): { label: string; color: string; dot: string } {
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

export function formatDateShort(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatDateFull(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Card Component ──────────────────────────────────
export function CampCard({ camp }: { camp: ActiveCamp }) {
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
