'use client';
import { useEffect, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { admin, errorMessage } from '@/lib/consult/api';
import { formatPaise } from '@/lib/consult/format';
import { formatIstDateTime, formatIstTime } from '@/lib/consult/time';
import { ONLINE_STATE, REQUEST_STATUS, formatDuration, formatHours, istDay } from '@/lib/consult/onlineNow';
import type { AdminInstantRequestDetail, InstantOutcomeWindow } from '@/lib/consult/types';
import { inputCls } from './shared';

const LIVE_POLL_MS = 5_000;
const OUTCOMES_POLL_MS = 30_000;

/** Calls `fn` every `ms` while the tab is visible. */
function usePoll(fn: () => void, ms: number) {
    useEffect(() => {
        const id = window.setInterval(() => {
            if (document.visibilityState === 'visible') fn();
        }, ms);
        return () => window.clearInterval(id);
    }, [fn, ms]);
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'warn' | 'bad' }) {
    const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-900';
    return (
        <div className="rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
        </div>
    );
}

// ── Online doctors and waiting patients (polled) ──

function LiveView({ onOpen }: { onOpen: (id: string) => void }) {
    const { data, error, loading, refetch } = useApi(() => admin.instantLive(), []);
    usePoll(refetch, LIVE_POLL_MS);

    if (loading && !data) return <LoadingBlock label="Loading who is online" />;
    if (error && !data) return <ErrorState message={error} onRetry={refetch} />;
    if (!data) return null;
    const waiting = data.requests.length;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
                <Stat label="Docs online" value={data.online} />
                <Stat label="Free now" value={data.free} tone={data.online > 0 && data.free === 0 ? 'warn' : 'default'} />
                <Stat label="Patients waiting" value={waiting} tone={waiting > 0 && data.free === 0 ? 'bad' : 'default'} />
            </div>
            {error && <p role="status" className="text-sm text-amber-700">Could not refresh just now; showing the last update.</p>}

            <Section title="Docs online" subtitle={`General Physicians taking instant consults. Updated ${formatIstTime(data.now)}.`}>
                {data.doctors.length === 0 ? (
                    <EmptyState title="No Doc is online" body="Doctors switch themselves online from their panel." />
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {data.doctors.map((d) => {
                            const s = ONLINE_STATE[d.state];
                            return (
                                <li key={d.doctorId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-gray-900">{d.doctorName}</p>
                                        <p className="text-xs text-gray-500">
                                            Online {formatDuration(d.onlineSeconds)}, since {formatIstTime(d.onlineSince)}
                                            {d.missedRings > 0 && <span className="text-amber-700"> · {d.missedRings} missed ring{d.missedRings > 1 ? 's' : ''} in a row</span>}
                                        </p>
                                    </div>
                                    <span title={s.hint}><Badge tone={s.tone}>{s.label}</Badge></span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Section>

            <Section title="Patients waiting" subtitle="Requests looking for a Doc, ringing, or waiting for payment. Open one to see who and why (logged).">
                {waiting === 0 ? (
                    <EmptyState title="Nobody is waiting" body="New requests show up here within a few seconds." />
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {data.requests.map((r) => {
                            const s = REQUEST_STATUS[r.status];
                            return (
                                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge tone={s.tone}>{s.label}</Badge>
                                            <span className="text-sm font-medium tabular-nums text-gray-900">waiting {formatDuration(r.waitingSeconds)}</span>
                                        </div>
                                        <p className="text-xs text-gray-500">
                                            {r.doctorsTried === 0 ? 'No Doc asked yet' : `${r.doctorsTried} Doc${r.doctorsTried > 1 ? 's' : ''} asked`}
                                            {r.doctor && ` · now ${r.doctor.name}`}
                                            {r.status === 'SEARCHING' && ` · search ends ${formatIstTime(r.searchEndsAt)}`}
                                            {r.payBy && ` · pay by ${formatIstTime(r.payBy)}`}
                                        </p>
                                    </div>
                                    <Button size="sm" variant="outline" onClick={() => onOpen(r.id)}>View request</Button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Section>
        </div>
    );
}

// ── One request (opening it writes an audit row) ──

function RequestDialog({ id, onClose }: { id: string; onClose: () => void }) {
    const [detail, setDetail] = useState<AdminInstantRequestDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        admin.instantRequest(id).then((d) => alive && setDetail(d), (e) => alive && setError(errorMessage(e)));
        return () => { alive = false; };
    }, [id]);
    const s = detail ? REQUEST_STATUS[detail.status] : null;

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Instant request</DialogTitle>
                    <DialogDescription>Opening a request is recorded in the audit log.</DialogDescription>
                </DialogHeader>
                {error ? <ErrorState message={error} />
                    : !detail || !s ? <LoadingBlock label="Loading the request" />
                    : (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                            <dt className="text-gray-500">Status</dt><dd><Badge tone={s.tone}>{s.label}</Badge></dd>
                            <dt className="text-gray-500">Patient</dt>
                            <dd className="text-gray-900">{detail.patient.name}{detail.patient.age != null && `, ${detail.patient.age}`}{detail.patient.gender && ` · ${detail.patient.gender}`}</dd>
                            <dt className="text-gray-500">Reason</dt><dd className="whitespace-pre-wrap break-words text-gray-900">{detail.reason}</dd>
                            <dt className="text-gray-500">Record shared</dt><dd className="text-gray-900">{detail.shareRecord ? 'Yes' : 'No'}</dd>
                            <dt className="text-gray-500">Asked at</dt><dd className="text-gray-900">{formatIstDateTime(detail.createdAt)}</dd>
                            <dt className="text-gray-500">Docs asked</dt><dd className="text-gray-900">{detail.doctorsTried}</dd>
                            {detail.passedBy.length > 0 && (<><dt className="text-gray-500">Passed by</dt><dd className="text-gray-900">{detail.passedBy.map((d) => d.name).join(', ')}</dd></>)}
                            {detail.doctor && (<><dt className="text-gray-500">{detail.status === 'RINGING' ? 'Ringing' : 'Doctor'}</dt><dd className="text-gray-900">{detail.doctor.name}</dd></>)}
                            {detail.payBy && detail.status === 'ACCEPTED' && (<><dt className="text-gray-500">Pay by</dt><dd className="text-gray-900">{formatIstTime(detail.payBy)}</dd></>)}
                            {detail.endedAt && (<><dt className="text-gray-500">Ended</dt><dd className="text-gray-900">{formatIstDateTime(detail.endedAt)}</dd></>)}
                        </dl>
                    )}
                <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
            </DialogContent>
        </Dialog>
    );
}

// ── Recent outcomes ──

function Outcomes() {
    const [period, setPeriod] = useState<InstantOutcomeWindow>('24h');
    const { data, error, loading, refetch } = useApi(() => admin.instantOutcomes(period), [period]);
    usePoll(refetch, OUTCOMES_POLL_MS);

    const toggle = (
        <div role="group" aria-label="Period" className="inline-flex rounded-xl border border-gray-200 p-0.5">
            {(['24h', '7d'] as const).map((w) => (
                <button
                    key={w}
                    type="button"
                    aria-pressed={period === w}
                    onClick={() => setPeriod(w)}
                    className={`rounded-lg px-3 py-1 text-sm ${period === w ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    {w === '24h' ? 'Last 24 h' : 'Last 7 days'}
                </button>
            ))}
        </div>
    );

    return (
        <Section title="Recent outcomes" subtitle="How instant requests ended, and what needs a look." action={toggle}>
            {loading && !data ? <LoadingBlock label="Loading outcomes" />
                : error && !data ? <ErrorState message={error} onRetry={refetch} />
                : data && (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <Stat label="Paid and booked" value={data.counts.booked} />
                            <Stat label="No Doc found" value={data.counts.noDoctorFound} tone={data.counts.noDoctorFound ? 'bad' : 'default'} />
                            <Stat label="Not paid in time" value={data.counts.unpaid} />
                            <Stat label="Cancelled by patient" value={data.counts.cancelled} />
                            <Stat label="Late payments refunded" value={data.counts.latePaymentsRefunded} tone={data.counts.latePaymentsRefunded ? 'warn' : 'default'} />
                            <Stat label={`Docs switched offline (${data.rules.missedRingsLimit} missed rings)`} value={data.counts.switchedOfflineMissedRings} tone={data.counts.switchedOfflineMissedRings ? 'warn' : 'default'} />
                        </div>
                        {data.switchedOffline.length > 0 && (
                            <div>
                                <h3 className="mb-2 text-sm font-semibold text-gray-700">Switched offline after missed rings</h3>
                                <ul className="space-y-1 text-sm text-gray-700">
                                    {data.switchedOffline.map((m) => <li key={m.id}>{m.doctorName} · {formatIstDateTime(m.at)}</li>)}
                                </ul>
                            </div>
                        )}
                        {data.lateRefunds.length > 0 && (
                            <div>
                                <h3 className="mb-2 text-sm font-semibold text-gray-700">Late payments refunded</h3>
                                <ul className="space-y-1 text-sm text-gray-700">
                                    {data.lateRefunds.map((r) => <li key={r.id}>{formatPaise(r.amountPaise)} · {r.status.toLowerCase()} · {formatIstDateTime(r.createdAt)}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
        </Section>
    );
}

// ── Hours online per doctor per IST day ──

function PresenceHours() {
    const [from, setFrom] = useState(() => istDay(new Date(), 6));
    const [to, setTo] = useState(() => istDay(new Date()));
    const [open, setOpen] = useState<string | null>(null);
    const { data, error, loading, refetch } = useApi(() => admin.presenceHours({ from, to }), [from, to]);

    return (
        <Section title="Hours online" subtitle="Time each Doc was online, per IST day. Up to 93 days at a time.">
            <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
                <div>
                    <label htmlFor="hours-from" className="mb-1 block text-sm font-medium text-gray-700">From</label>
                    <input id="hours-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={inputCls} />
                </div>
                <div>
                    <label htmlFor="hours-to" className="mb-1 block text-sm font-medium text-gray-700">To</label>
                    <input id="hours-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={inputCls} />
                </div>
            </div>
            {loading && !data ? <LoadingBlock label="Loading hours online" />
                : error ? <ErrorState message={error} onRetry={refetch} />
                : !data || data.doctors.length === 0 ? <EmptyState title="No time online in these dates" />
                : (
                    <ul className="divide-y divide-gray-100">
                        {data.doctors.map((d) => (
                            <li key={d.doctorId} className="py-3">
                                <button
                                    type="button"
                                    aria-expanded={open === d.doctorId}
                                    onClick={() => setOpen(open === d.doctorId ? null : d.doctorId)}
                                    className="flex w-full items-center justify-between gap-3 text-left"
                                >
                                    <span className="truncate font-medium text-gray-900">{d.doctorName}</span>
                                    <span className="shrink-0 text-sm tabular-nums text-gray-700">{formatHours(d.totalSeconds)} h · {d.days.length} day{d.days.length === 1 ? '' : 's'}</span>
                                </button>
                                {open === d.doctorId && (
                                    <table className="mt-2 w-full text-sm">
                                        <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 font-medium">Day</th><th className="py-1 font-medium">Sessions</th><th className="py-1 text-right font-medium">Online</th></tr></thead>
                                        <tbody>
                                            {d.days.map((x) => (
                                                <tr key={x.day} className="border-t border-gray-50">
                                                    <td className="py-1 text-gray-700">{x.day}</td>
                                                    <td className="py-1 tabular-nums text-gray-700">{x.sessions}</td>
                                                    <td className="py-1 text-right tabular-nums text-gray-900">{formatDuration(x.seconds)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
        </Section>
    );
}

export function OnlineNow() {
    const [openId, setOpenId] = useState<string | null>(null);
    return (
        <div className="space-y-6">
            <LiveView onOpen={setOpenId} />
            <Outcomes />
            <PresenceHours />
            {openId && <RequestDialog id={openId} onClose={() => setOpenId(null)} />}
        </div>
    );
}
