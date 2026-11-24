'use client';
/**
 * Super admin review moderation (P11): doctor and app reviews, filtered by status and stars. Hide,
 * unhide, delete (soft, final), redact personal data, and reply as DocNow. DocNow never writes or
 * re-rates a review (Aditya, 2026-11-24): redaction only takes words out, and the rating is fixed.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { ReasonDialog } from '@/components/consult/ReasonDialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { Stars } from '@/components/consult/reviews';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApi } from '@/hooks/useApi';
import { admin, errorMessage } from '@/lib/consult/api';
import { formatIstDateTime } from '@/lib/consult/time';
import type { AdminReview, ReviewKind, ReviewStatus } from '@/lib/consult/types';
import { cn } from '@/lib/utils';
import { inputCls } from './shared';

const STATUS_TONE = { VISIBLE: 'success', HIDDEN: 'warning', DELETED: 'muted' } as const;
const STATUS_LABEL: Record<ReviewStatus, string> = { VISIBLE: 'Shown', HIDDEN: 'Hidden', DELETED: 'Deleted' };

type Pending =
    | { kind: 'hide' | 'unhide' | 'delete'; review: AdminReview }
    | { kind: 'redact' | 'reply'; review: AdminReview };

const REASON_COPY = {
    hide: { title: 'Hide this review', confirm: 'Hide', text: 'It stops showing on public pages and in the average. You can unhide it later.' },
    unhide: { title: 'Show this review again', confirm: 'Unhide', text: 'It shows on public pages and counts in the average again.' },
    delete: { title: 'Delete this review', confirm: 'Delete', text: 'It is removed for good: it cannot be shown again, and an app review can no longer be changed by its author. The record is kept.' },
} as const;

/** Redact (the review's words with personal details taken out) or reply (DocNow's answer under it). */
function TextDialog({ pending, onClose, onDone }: { pending: Extract<Pending, { kind: 'redact' | 'reply' }>; onClose: () => void; onDone: (r: AdminReview) => void }) {
    const redact = pending.kind === 'redact';
    const [text, setText] = useState((redact ? pending.review.text : pending.review.replyText) ?? '');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const unchanged = redact && text.trim() === (pending.review.text ?? '');
    const valid = redact ? !unchanged && reason.trim().length >= 3 : text.trim() !== (pending.review.replyText ?? '');

    async function submit() {
        setBusy(true);
        setError(null);
        try {
            const body = redact ? { text: text.trim() || null, reason: reason.trim() } : { text: text.trim() || null };
            onDone(await admin.moderateReview(pending.review.kind, pending.review.id, pending.kind, body));
            onClose();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{redact ? 'Remove personal details' : pending.review.replyText ? 'Change DocNow\'s reply' : 'Reply as DocNow'}</DialogTitle>
                    <DialogDescription>
                        {redact
                            ? 'Delete only the personal details (phone numbers, emails, addresses, names). Do not add or reword anything else. The review is marked "Edited by DocNow", and the old words are not kept.'
                            : 'Shown under the review as "Reply from DocNow". Leave it empty to remove the reply.'}
                    </DialogDescription>
                </DialogHeader>
                <label htmlFor="review-text" className="block text-sm font-semibold text-ink">{redact ? 'Review text' : 'Reply'}</label>
                <textarea id="review-text" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} className={cn(inputCls, 'min-h-32 py-2')} />
                {redact && (
                    <>
                        <label htmlFor="redact-reason" className="block text-sm font-semibold text-ink">Reason</label>
                        <input id="redact-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Phone number" />
                    </>
                )}
                {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button onClick={submit} disabled={!valid || busy}>{busy ? 'Working...' : redact ? 'Save redaction' : text.trim() ? 'Post reply' : 'Remove reply'}</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function ReviewRow({ r, onAction }: { r: AdminReview; onAction: (p: Pending) => void }) {
    const live = r.status !== 'DELETED';
    return (
        <li className="space-y-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stars value={r.rating} />
                <span className="text-sm font-semibold tabular-nums text-ink">{r.rating}/5</span>
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                {r.redactedAt && <Badge tone="info">Edited by DocNow</Badge>}
                <span className="text-sm text-ink-muted">{formatIstDateTime(r.createdAt)}</span>
            </div>
            {r.text ? <p className="whitespace-pre-line break-words text-sm text-ink">{r.text}</p> : <p className="text-sm italic text-ink-muted">No text</p>}
            {r.replyText && (
                <div className="rounded-lg border-l-4 border-primary bg-surface-subtle px-3 py-2">
                    <p className="text-xs font-semibold text-primary">Reply from DocNow</p>
                    <p className="whitespace-pre-line break-words text-sm text-ink">{r.replyText}</p>
                </div>
            )}
            <p className="text-xs text-ink-muted">
                By {r.author.name || 'No name'} · {r.author.mobile}
                {r.kind === 'doctor' && r.doctor && (
                    <>
                        {' · '}for <Link href={`/super-admin/consult-doctors/${r.doctor.id}`} className="text-primary hover:underline">{r.doctor.displayName}</Link>
                        {r.patientName && <> · patient {r.patientName}</>}
                        {r.consultationId && (
                            <> · <Link href={`/super-admin/consult-appointments/${r.consultationId}`} className="text-primary hover:underline">consultation{r.consultationStartsAt ? ` of ${formatIstDateTime(r.consultationStartsAt)}` : ''}</Link></>
                        )}
                    </>
                )}
            </p>
            {!live && r.text && (
                <div className="pt-1">
                    {/* Deleted rows keep their text: personal details must still be removable (e.g. a data request). */}
                    <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'redact', review: r })}>Remove personal details</Button>
                </div>
            )}
            {live && (
                <div className="flex flex-wrap gap-2 pt-1">
                    {r.status === 'VISIBLE'
                        ? <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'hide', review: r })}>Hide</Button>
                        : <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'unhide', review: r })}>Unhide</Button>}
                    <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'reply', review: r })}>{r.replyText ? 'Edit reply' : 'Reply'}</Button>
                    {r.text && <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'redact', review: r })}>Remove personal details</Button>}
                    <Button size="sm" variant="danger" onClick={() => onAction({ kind: 'delete', review: r })}>Delete</Button>
                </div>
            )}
        </li>
    );
}

export function ReviewModeration() {
    const [kind, setKind] = useState<ReviewKind>('doctor');
    const [status, setStatus] = useState<ReviewStatus | ''>('');
    const [rating, setRating] = useState<number | ''>('');
    const [page, setPage] = useState(1);
    const [pending, setPending] = useState<Pending | null>(null);
    const { data, error, loading, refetch, setData } = useApi(() => admin.reviews({ kind, status, rating, page }), [kind, status, rating, page]);

    const replace = (r: AdminReview) => setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === r.id ? { ...x, ...r } : x)) } : d));
    const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
    const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

    return (
        <div className="space-y-4">
            <div role="tablist" aria-label="Review type" className="inline-flex rounded-lg border border-border bg-surface p-1">
                {(['doctor', 'app'] as const).map((k) => (
                    <button
                        key={k}
                        role="tab"
                        aria-selected={kind === k}
                        onClick={() => filter(setKind)(k)}
                        className={cn('rounded-md px-4 py-2 text-sm font-semibold', kind === k ? 'bg-primary text-on-primary' : 'text-ink-muted hover:text-ink')}
                    >
                        {k === 'doctor' ? 'Doctor reviews' : 'App reviews'}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap gap-3">
                <label className="text-sm font-semibold text-ink">
                    Status
                    <select className={cn(inputCls, 'mt-1 block w-40')} value={status} onChange={(e) => filter(setStatus)(e.target.value as ReviewStatus | '')}>
                        <option value="">All</option>
                        <option value="VISIBLE">Shown</option>
                        <option value="HIDDEN">Hidden</option>
                        <option value="DELETED">Deleted</option>
                    </select>
                </label>
                <label className="text-sm font-semibold text-ink">
                    Stars
                    <select className={cn(inputCls, 'mt-1 block w-32')} value={rating} onChange={(e) => filter(setRating)(e.target.value ? Number(e.target.value) : '')}>
                        <option value="">Any</option>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'star' : 'stars'}</option>)}
                    </select>
                </label>
            </div>

            {loading && !data && <LoadingBlock label="Loading reviews" />}
            {error && <ErrorState message={error} onRetry={refetch} />}
            {data && data.items.length === 0 && <EmptyState title="No reviews" body="Nothing matches these filters." />}
            {data && data.items.length > 0 && (
                <>
                    <p className="text-sm text-ink-muted">{data.total} {data.total === 1 ? 'review' : 'reviews'}</p>
                    <ul className="space-y-3">{data.items.map((r) => <ReviewRow key={r.id} r={r} onAction={setPending} />)}</ul>
                    {pages > 1 && (
                        <div className="flex items-center justify-between gap-3">
                            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                            <span className="text-sm text-ink-muted">Page {page} of {pages}</span>
                            <Button variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                        </div>
                    )}
                </>
            )}

            {pending && (pending.kind === 'redact' || pending.kind === 'reply') && (
                <TextDialog pending={pending} onClose={() => setPending(null)} onDone={replace} />
            )}
            <ReasonDialog
                open={!!pending && (pending.kind === 'hide' || pending.kind === 'unhide' || pending.kind === 'delete')}
                title={pending && pending.kind in REASON_COPY ? REASON_COPY[pending.kind as keyof typeof REASON_COPY].title : ''}
                description={pending && pending.kind in REASON_COPY ? REASON_COPY[pending.kind as keyof typeof REASON_COPY].text : undefined}
                confirmLabel={pending && pending.kind in REASON_COPY ? REASON_COPY[pending.kind as keyof typeof REASON_COPY].confirm : ''}
                destructive={pending?.kind === 'delete'}
                onClose={() => setPending(null)}
                onConfirm={async (reason) => {
                    if (!pending) return;
                    const r = await admin.moderateReview(pending.review.kind, pending.review.id, pending.kind, { reason });
                    // A filtered list drops the row once it no longer matches; otherwise update it in place.
                    if (status && r.status !== status) void refetch();
                    else replace(r);
                }}
            />
        </div>
    );
}
