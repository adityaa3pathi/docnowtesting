'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { ReasonDialog } from '@/components/consult/ReasonDialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { admin } from '@/lib/consult/api';
import { formatPaise } from '@/lib/consult/format';
import { statusInfo } from '@/lib/consult/status';
import { inputCls } from './shared';

type Action =
    | { kind: 'confirm' | 'refund'; id: string }
    | { kind: 'retry'; id: string }
    | { kind: 'cancel'; id: string };

const COPY = {
    confirm: { title: 'Confirm this payment', confirm: 'Confirm booking', text: 'The patient keeps the slot.' },
    refund: { title: 'Refund this payment', confirm: 'Refund', text: 'The patient gets their money back.' },
    retry: { title: 'Retry this refund', confirm: 'Retry refund', text: 'We will try to send the money again.' },
    cancel: { title: 'Cancel this consultation', confirm: 'Cancel consultation', text: 'The patient is cancelled and refunded by the usual rules.' },
} as const;

const OUTCOME_TEXT: Record<string, string> = {
    confirmed: 'Booking confirmed.',
    refunded: 'Refund started.',
    refund_created: 'Refund started.',
};

export function ReviewQueue() {
    const { data, error, loading, refetch } = useApi(() => admin.review(), []);
    const [action, setAction] = useState<Action | null>(null);
    const [outcomes, setOutcomes] = useState<string[]>([]);
    const [cancelId, setCancelId] = useState('');
    const note = (m: string) => setOutcomes((o) => [m, ...o].slice(0, 5));

    async function run(reason: string) {
        if (!action) return;
        if (action.kind === 'retry') {
            const r = await admin.retryRefund(action.id, reason);
            note(`Refund retry: ${OUTCOME_TEXT[r.outcome] ?? r.outcome}`);
        } else if (action.kind === 'cancel') {
            const r = await admin.cancelConsultation(action.id, reason);
            note(`Consultation cancelled. Refund ${formatPaise(r.refundPaise)}${r.refundStatus ? ` (${r.refundStatus.toLowerCase()})` : ''}.`);
            setCancelId('');
        } else {
            const r = await admin.resolve(action.id, action.kind, reason);
            note(`Payment ${action.kind === 'confirm' ? 'confirm' : 'refund'}: ${OUTCOME_TEXT[r.outcome] ?? r.outcome}`);
        }
        void refetch();
    }

    const copy = action ? COPY[action.kind] : null;
    const idOk = /^[0-9a-f-]{36}$/i.test(cancelId.trim());

    return (
        <div className="space-y-8">
            <div aria-live="polite">
                {outcomes.length > 0 && (
                    <ul className="space-y-1 rounded-2xl bg-green-50 p-4 text-sm text-green-800">
                        {outcomes.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                )}
            </div>

            {loading && !data ? <LoadingBlock label="Loading the review queue" />
                : error ? <ErrorState message={error} onRetry={refetch} />
                : !data || (data.flaggedPayments.length === 0 && data.refundsNeedingStaff.length === 0) ? (
                    <EmptyState title="Nothing needs staff right now" body="Flagged payments and stuck refunds will show up here." />
                ) : (
                    <>
                        {data.flaggedPayments.length > 0 && (
                            <section aria-labelledby="flagged-h">
                                <h2 id="flagged-h" className="mb-3 text-lg font-semibold text-gray-900">Payments to check</h2>
                                <ul className="space-y-3">
                                    {data.flaggedPayments.map((p) => (
                                        <li key={p.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Badge tone={statusInfo(p.status).tone}>{statusInfo(p.status).label}</Badge>
                                                <span className="break-all text-xs text-gray-500">{p.id}</span>
                                            </div>
                                            <p className="mt-2 text-sm text-gray-700">{p.reviewReason ?? 'Needs a check.'}</p>
                                            <p className="text-sm text-gray-500">Fee {formatPaise(p.feePaise)}</p>
                                            <div className="mt-3 flex gap-2">
                                                <Button size="sm" onClick={() => setAction({ kind: 'confirm', id: p.id })}>Confirm</Button>
                                                <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'refund', id: p.id })}>Refund</Button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        {data.refundsNeedingStaff.length > 0 && (
                            <section aria-labelledby="refunds-h">
                                <h2 id="refunds-h" className="mb-3 text-lg font-semibold text-gray-900">Refunds that did not go through</h2>
                                <ul className="space-y-3">
                                    {data.refundsNeedingStaff.map((r) => (
                                        <li key={r.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                                            <p className="font-semibold text-gray-900">{formatPaise(r.amountPaise)}</p>
                                            <p className="break-all text-xs text-gray-500">Consultation {r.consultationId}</p>
                                            <p className="mt-1 text-sm text-gray-700">{r.reason} · {r.attempts} tries{r.failureConfirmed ? ' · the bank confirmed it failed' : ''}</p>
                                            {r.lastError && <p className="text-sm text-red-600">{r.lastError}</p>}
                                            <div className="mt-3"><Button size="sm" onClick={() => setAction({ kind: 'retry', id: r.id })}>Retry</Button></div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </>
                )}

            <section aria-labelledby="cancel-h" className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
                <h2 id="cancel-h" className="mb-1 text-lg font-semibold text-gray-900">Cancel a consultation</h2>
                <p className="mb-3 text-sm text-gray-500">Paste the consultation id. The patient is refunded by the usual rules.</p>
                <label htmlFor="cancel-id" className="mb-1 block text-sm font-medium text-gray-700">Consultation id</label>
                <div className="flex flex-wrap gap-2">
                    <input id="cancel-id" value={cancelId} onChange={(e) => setCancelId(e.target.value)} className={`${inputCls} min-w-0 flex-1`} />
                    <Button variant="outline" disabled={!idOk} onClick={() => setAction({ kind: 'cancel', id: cancelId.trim() })}>Cancel consultation</Button>
                </div>
                {cancelId !== '' && !idOk && <p className="mt-1 text-xs text-red-600">That does not look like a consultation id.</p>}
            </section>

            {action && copy && (
                <ReasonDialog open title={copy.title} description={copy.text} confirmLabel={copy.confirm} destructive={action.kind !== 'confirm'} onClose={() => setAction(null)} onConfirm={run} />
            )}
        </div>
    );
}
