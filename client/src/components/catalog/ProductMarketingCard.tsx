'use client';

import Link from 'next/link';
import { ShoppingCart, Clock3, FlaskConical, Loader2, Users, ArrowRight } from 'lucide-react';

export interface ProductDetailsSummary {
    testCount: number | null;
    constituentsPreview: string[];
    remainingConstituents: number;
    fastingLabel: string | null;
    idealFor: string | null;
    reportingTime: string | null;
}

export interface ProductMarketingCardItem {
    id: string;
    partnerCode: string;
    name: string;
    type: string;
    price: number;
    mrp?: number | null;
    reportTime?: string | null;
    parameters?: string | null;
    detailsSummary?: ProductDetailsSummary | null;
}

interface ProductMarketingCardProps<T extends ProductMarketingCardItem> {
    product: T;
    detailHref: string;
    onBookNow: (product: T) => void;
    isBooking?: boolean;
    inCartCount?: number;
}

function getFallbackCount(parameters?: string | null) {
    const match = parameters?.match(/\d+/);
    return match ? Number(match[0]) : null;
}

function getDisplayCount(product: ProductMarketingCardItem) {
    return product.detailsSummary?.testCount || getFallbackCount(product.parameters) || (product.type === 'TEST' ? 1 : null);
}

function getItemLabel(product: ProductMarketingCardItem) {
    return product.type === 'TEST' || product.type === 'PARAMETER' ? 'Parameters included' : 'Tests included';
}

/**
 * Formats raw API test names into clean, human-readable display names.
 * e.g. "COW MILK-By Elisa Method" → "Cow Milk"
 *      "CHEESE CHEDDAR TYPE-By Elis..." → "Cheese Cheddar Type"
 *      "Allergen, Individual-Food Casein..." → "Allergen, Individual-Food Casein"
 */
function formatTestName(raw: string): string {
    // Strip trailing method suffixes like "-By Elisa Method", "-By HPLC", etc.
    const cleaned = raw.replace(/-By\s+.*/i, '').replace(/\.\.\.$/, '').trim();
    // Title-case: capitalize first letter of each word, lowercase the rest
    return cleaned
        .split(/\s+/)
        .map((word) => {
            // Keep short conjunctions/prepositions lowercase unless they're the first word
            if (word.length <= 2) return word.toLowerCase();
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
}

function getDiscountPercent(price: number, mrp?: number | null): number | null {
    if (!mrp || mrp <= price) return null;
    return Math.round(((mrp - price) / mrp) * 100);
}

export function ProductMarketingCard<T extends ProductMarketingCardItem>({
    product,
    detailHref,
    onBookNow,
    isBooking = false,
    inCartCount = 0,
}: ProductMarketingCardProps<T>) {
    const summary = product.detailsSummary;
    const count = getDisplayCount(product);
    const previewItems = summary?.constituentsPreview || [];
    const showIncludedList = previewItems.length > 0;
    const reportTime = summary?.reportingTime || product.reportTime;
    const fastingLabel = summary?.fastingLabel || 'Not specified';
    const idealFor = summary?.idealFor || 'All';
    const discount = getDiscountPercent(product.price, product.mrp);
    const isTest = product.type === 'TEST' || product.type === 'PARAMETER';
    const isProfile = product.type === 'PROFILE';
    const badgeTone = isTest
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : isProfile
        ? 'border-teal-200 bg-teal-50 text-teal-700'
        : 'border-primary/20 bg-primary/5 text-primary';

    return (
        <article className="relative flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:shadow-lg hover:border-gray-300 group">
            {/* ── Header: Title + Test Count Badge ── */}
            <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
                <div className="min-w-0 flex-1 flex flex-col gap-2">
                    <h3 className="text-lg font-bold leading-snug text-gray-900 line-clamp-2">
                        <Link href={detailHref} className="hover:text-primary focus:outline-none before:absolute before:inset-0 before:z-0">
                            {product.name}
                        </Link>
                    </h3>
                    {inCartCount > 0 && (
                        <div className="flex">
                            <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-bold text-green-700 border border-green-100">
                                {inCartCount} in cart
                            </span>
                        </div>
                    )}
                </div>
                <div className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border-2 ${badgeTone}`}>
                    <div className="text-2xl font-extrabold leading-none">{count || '--'}</div>
                    <div className="mt-0.5 text-xs font-semibold leading-none opacity-70">{count === 1 ? 'Test' : 'Tests'}</div>
                </div>
            </div>

            {/* ── Tests Included: Inline Flow (Packages/Profiles) ── */}
            {!isTest && !isProfile && (
                <div className="mx-5 border-t border-gray-100 pt-4">
                    <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-gray-900">{getItemLabel(product)}:</p>
                    </div>

                    {showIncludedList ? (
                        <p className="mt-1 min-h-[40px] text-sm leading-relaxed text-gray-500">
                            {previewItems.slice(0, 4).map(formatTestName).join(', ')}
                            {(summary?.remainingConstituents || 0) > 0 && (
                                <>
                                    {' '}
                                    <Link href={detailHref} className="relative z-10 font-semibold text-primary hover:underline">
                                        ...more
                                    </Link>
                                </>
                            )}
                        </p>
                    ) : (
                        <p className="mt-1 min-h-[40px] text-sm leading-relaxed text-gray-400">
                            Details available on the product page.
                        </p>
                    )}

                    {/* Know More link */}
                    <div className="mt-4 pb-4">
                        <Link href={detailHref} className="relative z-10 text-sm font-semibold text-primary hover:underline">
                            + Know More
                        </Link>
                    </div>
                </div>
            )}

            {/* ── Meta Bar: Fasting / Ideal For / Report Time ── */}
            <div className="mt-auto border-y border-gray-100 px-5 py-3">
                <div className="grid grid-cols-3 gap-3 text-xs font-medium leading-tight text-gray-500">
                    <div className="flex items-start gap-1.5">
                        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-emerald-500 mt-0.5" />
                        <span className="leading-tight">
                            {fastingLabel.toLowerCase().includes('fasting') ? fastingLabel : `Fasting: ${fastingLabel}`}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                        <span>Ideal for {idealFor}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span>{reportTime ? `Reports in ${reportTime}` : 'Report time varies'}</span>
                    </div>
                </div>
            </div>

            {/* ── Bottom Bar: Price + Single CTA ── */}
            <div className="flex items-center justify-between gap-4 rounded-b-xl bg-gray-50/80 px-5 py-3.5">
                <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-2xl font-extrabold leading-none text-gray-900">₹{product.price}</span>
                        {product.mrp && product.mrp > product.price && (
                            <span className="text-sm font-medium text-gray-400 line-through">₹{product.mrp}</span>
                        )}
                    </div>
                    {product.mrp && product.mrp > product.price && (
                        <div className="flex items-center gap-1.5 mt-1">
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                                {discount}% OFF
                            </span>
                            <span className="text-xs font-bold text-green-600">
                                Save ₹{product.mrp - product.price}
                            </span>
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => onBookNow(product)}
                    disabled={isBooking}
                    className={`relative z-10 inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-60 ${
                        inCartCount > 0
                            ? 'bg-slate-800 text-white hover:bg-slate-700'
                            : 'bg-primary text-white hover:opacity-90'
                    }`}
                    aria-label={inCartCount > 0 ? `Go to cart` : `Add ${product.name} to cart`}
                >
                    {isBooking ? <Loader2 className="h-4 w-4 animate-spin" /> : inCartCount > 0 ? (
                        <>
                            <span>Go to Cart</span>
                            <ArrowRight className="h-4 w-4" />
                        </>
                    ) : (
                        <>
                            <ShoppingCart className="h-4 w-4" />
                            <span>Add to Cart</span>
                        </>
                    )}
                </button>
            </div>
        </article>
    );
}
