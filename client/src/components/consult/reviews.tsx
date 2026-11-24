'use client';
/**
 * P11 reviews: stars, the star picker, the review form, and a paged review list. The author is never
 * named on public pages ("Verified patient"), and DocNow's own words only ever appear as a reply.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui';
import { errorMessage } from '@/lib/consult/api';
import type { OwnReview, PublicReview, RatingSummary, ReviewPage } from '@/lib/consult/types';

export const REVIEW_TEXT_MAX = 1000;
const LABELS = ['', 'Poor', 'Below average', 'Okay', 'Good', 'Excellent'];

/** "24 Nov 2026" from the server's YYYY-MM-DD day (already Indian time). */
export const dateLabel = (day: string) =>
    new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

/** Read-only stars; fractions round to the nearest half visually, the number says the rest. */
export function Stars({ value, className = 'h-4 w-4' }: { value: number; className?: string }) {
    return (
        <span className="inline-flex items-center gap-0.5" aria-hidden>
            {[1, 2, 3, 4, 5].map((n) => {
                const fill = Math.max(0, Math.min(1, Math.round((value - n + 1) * 2) / 2));
                return (
                    <span key={n} className="relative inline-block">
                        <Star className={`${className} text-border-strong`} />
                        {fill > 0 && (
                            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                                <Star className={`${className} fill-warning text-warning`} />
                            </span>
                        )}
                    </span>
                );
            })}
        </span>
    );
}

/** "★ 4.3 (12 reviews)" or nothing below the threshold. */
export function RatingBadge({ rating, compact }: { rating: RatingSummary | null | undefined; compact?: boolean }) {
    if (!rating) return null;
    const label = `Rated ${rating.average.toFixed(1)} out of 5 from ${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}`;
    return (
        <span className="inline-flex items-center gap-1.5 text-sm" aria-label={label} role="img">
            <Star className="h-4 w-4 fill-warning text-warning" aria-hidden />
            <strong className="font-bold tabular-nums text-ink">{rating.average.toFixed(1)}</strong>
            <span className="text-ink-muted">({rating.count}{compact ? '' : rating.count === 1 ? ' review' : ' reviews'})</span>
        </span>
    );
}

/** Five radio buttons styled as stars: arrow keys move, the label says what each means. */
export function StarPicker({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
    const name = useId();
    const [hover, setHover] = useState(0);
    const shown = hover || value;
    return (
        <fieldset className="flex flex-wrap items-center gap-3" disabled={disabled}>
            <legend className="sr-only">Your rating</legend>
            <div className="flex" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="cursor-pointer rounded-md p-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary" onMouseEnter={() => setHover(n)}>
                        <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" aria-label={`${n} ${n === 1 ? 'star' : 'stars'}: ${LABELS[n]}`} />
                        <Star className={`h-8 w-8 transition-colors ${n <= shown ? 'fill-warning text-warning' : 'text-border-strong'}`} aria-hidden />
                    </label>
                ))}
            </div>
            <span className="min-w-24 text-sm font-semibold text-ink" aria-live="polite">{shown ? LABELS[shown] : ''}</span>
        </fieldset>
    );
}

/** Stars plus optional words. `initial` fills it for an edit. */
export function ReviewForm({ initial, submitLabel, placeholder, onSubmit, onCancel }: {
    initial?: { rating: number; text: string | null };
    submitLabel: string;
    placeholder: string;
    onSubmit: (body: { rating: number; text?: string }) => Promise<void>;
    onCancel?: () => void;
}) {
    const [rating, setRating] = useState(initial?.rating ?? 0);
    const [text, setText] = useState(initial?.text ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const textId = useId();

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!rating) return setError('Choose 1 to 5 stars');
        setBusy(true);
        setError(null);
        try {
            await onSubmit({ rating, text: text.trim() || undefined });
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={submit} className="space-y-3">
            <StarPicker value={rating} onChange={(n) => { setRating(n); setError(null); }} disabled={busy} />
            <div>
                <label htmlFor={textId} className="block text-sm font-semibold text-ink">Tell others more <span className="font-normal text-ink-muted">(optional)</span></label>
                <textarea
                    id={textId}
                    value={text}
                    maxLength={REVIEW_TEXT_MAX}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={placeholder}
                    disabled={busy}
                    className="mt-1 min-h-24 w-full rounded-xl border border-border bg-input p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-xs text-ink-muted">Shown publicly without your name. Please leave out phone numbers and other personal details.</p>
            </div>
            {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
                {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>}
            </div>
        </form>
    );
}

/** One review as anyone sees it. */
export function ReviewItem({ review, author = 'Verified patient' }: { review: PublicReview; author?: string }) {
    return (
        <li className="border-b border-border py-4 last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stars value={review.rating} />
                <span className="sr-only">{review.rating} out of 5</span>
                <span className="text-sm font-semibold text-ink">{author}</span>
                <span className="text-sm text-ink-muted">{dateLabel(review.createdOn)}</span>
            </div>
            {review.text && <p className="mt-2 whitespace-pre-line break-words text-sm text-ink">{review.text}</p>}
            {review.editedByDocNow && <p className="mt-1 text-xs italic text-ink-muted">Edited by DocNow to remove personal details</p>}
            {review.reply && (
                <div className="mt-3 rounded-lg border-l-4 border-primary bg-surface-subtle px-3 py-2">
                    <p className="text-xs font-semibold text-primary">Reply from DocNow</p>
                    <p className="mt-0.5 whitespace-pre-line break-words text-sm text-ink">{review.reply.text}</p>
                </div>
            )}
        </li>
    );
}

/** The author's own review, with a note if DocNow took it down. */
export function OwnReviewView({ review }: { review: OwnReview }) {
    return (
        <div>
            <ul><ReviewItem review={review} author="Your review" /></ul>
            {review.status === 'HIDDEN' && <p className="text-sm text-ink-muted">DocNow is not showing this review publicly right now.</p>}
            {review.status === 'DELETED' && <p className="text-sm text-ink-muted">DocNow removed this review.</p>}
        </div>
    );
}

/** A paged list from any review endpoint; "Show more" appends the next page. */
export function ReviewList({ load, empty, onLoaded }: {
    load: (page: number) => Promise<Omit<ReviewPage, 'rating'>>;
    empty: string;
    onLoaded?: (first: Omit<ReviewPage, 'rating'>) => void;
}) {
    const [items, setItems] = useState<PublicReview[] | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchPage = useCallback(async (p: number) => {
        setBusy(true);
        setError(null);
        try {
            const res = await load(p);
            // A review added between pages shifts the offsets: never show one twice.
            setItems((prev) => {
                if (p === 1) return res.items;
                const seen = new Set((prev ?? []).map((r) => r.id));
                return [...(prev ?? []), ...res.items.filter((r) => !seen.has(r.id))];
            });
            setTotal(res.total);
            setPage(p);
            if (p === 1) onLoaded?.(res);
        } catch (e) {
            setError(errorMessage(e, 'Reviews could not be loaded.'));
        } finally {
            setBusy(false);
        }
    }, [load, onLoaded]);

    useEffect(() => { void fetchPage(1); }, [fetchPage]);

    if (error && !items) return <p className="text-sm text-ink-muted" role="alert">{error} <button type="button" className="font-semibold text-primary underline" onClick={() => fetchPage(1)}>Try again</button></p>;
    if (!items) return <p className="text-sm text-ink-muted">Loading reviews…</p>;
    if (!items.length) return <p className="text-sm text-ink-muted">{empty}</p>;
    return (
        <div>
            <ul>{items.map((r) => <ReviewItem key={r.id} review={r} />)}</ul>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {items.length < total && (
                <Button variant="outline" className="mt-2" disabled={busy} onClick={() => fetchPage(page + 1)}>
                    {busy ? 'Loading…' : `Show more reviews (${total - items.length})`}
                </Button>
            )}
        </div>
    );
}
