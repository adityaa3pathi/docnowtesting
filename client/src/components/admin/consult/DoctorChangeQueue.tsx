'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarOff } from 'lucide-react';
import { Button } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { ChangeDiff } from '@/components/consult/ChangeDiff';
import { ConfirmDialog } from '@/components/consult/ConfirmDialog';
import { ReasonDialog } from '@/components/consult/ReasonDialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { admin } from '@/lib/consult/api';
import { CHANGE_KIND_LABEL, changeDiff } from '@/lib/consult/changes';
import { doctorStatusInfo } from '@/lib/consult/status';
import { formatIstDateTime } from '@/lib/consult/time';
import type { AdminDoctorChange, DoctorChangeStatus } from '@/lib/consult/types';
import { cn } from '@/lib/utils';

const TABS: { status: DoctorChangeStatus; label: string }[] = [
    { status: 'PENDING', label: 'Waiting' },
    { status: 'APPROVED', label: 'Approved' },
    { status: 'REJECTED', label: 'Not approved' },
];

type Action = { kind: 'approve' | 'reject'; change: AdminDoctorChange };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** "1 booked appointment falls", "2 booked appointments fall". */
const pluralVerb = (n: number, word: string, one: string, many: string) => `${plural(n, word)} ${n === 1 ? one : many}`;

export function DoctorChangeQueue() {
    const [status, setStatus] = useState<DoctorChangeStatus>('PENDING');
    const { data, error, loading, refetch } = useApi(() => admin.doctorChanges(status), [status]);
    const [action, setAction] = useState<Action | null>(null);
    const [outcomes, setOutcomes] = useState<string[]>([]);
    const note = (m: string) => setOutcomes((o) => [m, ...o].slice(0, 5));

    async function approve(change: AdminDoctorChange) {
        const r = await admin.approveChange(change.id);
        const n = r.bookedKeptOutsideHours;
        const kept = n ? ` ${plural(n, 'booked appointment')} outside the new hours ${n === 1 ? 'stays' : 'stay'} booked.` : '';
        note(`${change.doctor.displayName}: ${CHANGE_KIND_LABEL[change.kind].toLowerCase()} approved.${kept}`);
        void refetch();
    }
    async function reject(change: AdminDoctorChange, reason: string) {
        await admin.rejectChange(change.id, reason);
        note(`${change.doctor.displayName}: ${CHANGE_KIND_LABEL[change.kind].toLowerCase()} not approved. The doctor sees your reason.`);
        void refetch();
    }

    return (
        <div className="space-y-6">
            <div aria-live="polite">
                {outcomes.length > 0 && (
                    <ul className="space-y-1 rounded-2xl bg-green-50 p-4 text-sm text-green-800">
                        {outcomes.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                )}
            </div>

            <div role="tablist" aria-label="Change status" className="flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
                {TABS.map((t) => (
                    <button key={t.status} role="tab" type="button" aria-selected={status === t.status} onClick={() => setStatus(t.status)}
                        className={cn('min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold', status === t.status ? 'bg-white text-primary shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
                        {t.label}
                    </button>
                ))}
            </div>

            {loading && !data ? <LoadingBlock label="Loading doctor changes" />
                : error ? <ErrorState message={error} onRetry={refetch} />
                : !data || data.requests.length === 0 ? (
                    <EmptyState
                        title={status === 'PENDING' ? 'No changes waiting' : 'Nothing here yet'}
                        body={status === 'PENDING' ? 'When a doctor changes their hours or profile, it shows up here for you to approve.' : 'Decided changes from doctors show up here.'}
                    />
                ) : (
                    <ul className="space-y-4">
                        {data.requests.map((c) => <ChangeCard key={c.id} change={c} onAction={(kind) => setAction({ kind, change: c })} />)}
                    </ul>
                )}

            {data && status === 'PENDING' && (
                <section aria-labelledby="leave-h" className="space-y-3">
                    <div>
                        <h2 id="leave-h" className="text-lg font-semibold text-gray-900">Leave added in the last 7 days</h2>
                        <p className="text-sm text-gray-500">Leave starts at once, so doctors can step away in an emergency. Booked appointments inside it need a person to move or cancel them.</p>
                    </div>
                    {data.recentLeave.length === 0 ? (
                        <p className="rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-500">No new leave.</p>
                    ) : (
                        <ul className="space-y-2">
                            {data.recentLeave.map((l) => (
                                <li key={l.id} className="flex flex-wrap items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-sm shadow-sm">
                                    <CalendarOff className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" aria-hidden />
                                    <div className="min-w-0 flex-1">
                                        <Link href={`/super-admin/consult-doctors/${l.doctorId}`} className="font-semibold text-gray-900 hover:text-primary">{l.doctor.displayName}</Link>
                                        <p className="text-gray-700">{formatIstDateTime(l.startsAt)} to {formatIstDateTime(l.endsAt)}</p>
                                        {l.reason && <p className="text-gray-500">{l.reason}</p>}
                                        <p className="text-xs text-gray-400">Added {formatIstDateTime(l.createdAt)}</p>
                                    </div>
                                    {l.bookedInside > 0 && <Badge tone="danger">{plural(l.bookedInside, 'booked appointment')} inside</Badge>}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            <ConfirmDialog
                open={action?.kind === 'approve'}
                title={action ? `Approve ${CHANGE_KIND_LABEL[action.change.kind].toLowerCase()}?` : ''}
                description={action?.change.kind === 'AVAILABILITY'
                    ? 'Patients can book the new hours at once. Free slots outside them are removed; booked appointments stay booked.'
                    : 'Patients see the new details at once.'}
                confirmLabel="Approve"
                onClose={() => setAction(null)}
                onConfirm={() => approve(action!.change)}
            />
            <ReasonDialog
                open={action?.kind === 'reject'}
                title="Do not approve this change"
                description="The doctor sees this reason. Their current hours and details stay as they are."
                confirmLabel="Do not approve"
                destructive
                onClose={() => setAction(null)}
                onConfirm={(reason) => reject(action!.change, reason)}
            />
        </div>
    );
}

function ChangeCard({ change: c, onAction }: { change: AdminDoctorChange; onAction: (kind: 'approve' | 'reject') => void }) {
    const pending = c.status === 'PENDING';
    // Waiting: compare with the doctor's values now. Decided: with the values when it was sent.
    const rows = changeDiff(c.kind, pending ? c.live : c.previous, c.payload);
    const doctorInfo = doctorStatusInfo(c.doctor.status);
    return (
        <li className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <Link href={`/super-admin/consult-doctors/${c.doctorId}`} className="font-semibold text-gray-900 hover:text-primary">{c.doctor.displayName}</Link>
                    <p className="text-sm text-gray-500">{c.doctor.specialty?.name ?? 'General'} · sent {formatIstDateTime(c.createdAt)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Badge tone="info">{CHANGE_KIND_LABEL[c.kind]}</Badge>
                    {c.doctor.status !== 'APPROVED' && <Badge tone={doctorInfo.tone}>Doctor: {doctorInfo.label}</Badge>}
                </div>
            </div>
            <ChangeDiff rows={rows} beforeLabel={pending ? 'Now' : 'Before'} afterLabel="Asked for" />
            {pending && (c.bookedOutsideNewHours ?? 0) > 0 && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {pluralVerb(c.bookedOutsideNewHours!, 'booked appointment', 'falls', 'fall')} outside the new hours. {c.bookedOutsideNewHours === 1 ? 'It stays' : 'They stay'} booked, and the doctor must still see {c.bookedOutsideNewHours === 1 ? 'it' : 'them'}.
                </p>
            )}
            {pending ? (
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => onAction('approve')}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => onAction('reject')}>Do not approve</Button>
                </div>
            ) : (
                <p className="text-sm text-gray-600">
                    {c.status === 'APPROVED' ? 'Approved' : 'Not approved'}{c.reviewedAt ? ` ${formatIstDateTime(c.reviewedAt)}` : ''}
                    {c.reviewReason ? `. Reason: ${c.reviewReason}` : ''}
                </p>
            )}
        </li>
    );
}
