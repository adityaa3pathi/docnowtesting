'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ExternalLink, FileText, FlaskConical, Loader2, ShieldCheck } from 'lucide-react';
import { PrescriptionView } from '@/components/consult/PrescriptionView';
import { useApi } from '@/hooks/useApi';
import { getApiUrl } from '@/lib/api';
import { admin as adminApi, errorMessage } from '@/lib/consult/api';
import { formatPaise } from '@/lib/consult/format';
import { statusInfo } from '@/lib/consult/status';
import { formatIstDateTime, formatIstDay } from '@/lib/consult/time';
import type { AdminPatientRecord, SharedFile, SharedItemKind } from '@/lib/consult/types';

const card = 'rounded-xl border border-gray-200 bg-white p-5';
const h2 = 'mb-3 text-lg font-semibold text-gray-900';
const ACTION_LABEL: Record<string, string> = { RECORD: 'Opened the record', DOCUMENT: 'Opened a medical file', REPORT: 'Opened a lab report', ATTACHMENT: 'Opened a booking file' };

function Tags({ items, empty, warn }: { items: string[]; empty: string; warn?: boolean }) {
    if (!items.length) return <span className="text-gray-500">{empty}</span>;
    return <span className="flex flex-wrap gap-1">{items.map((x) => <span key={x} className={`rounded-full px-2 py-0.5 text-xs font-medium ${warn ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-800'}`}>{x}</span>)}</span>;
}

function OpenButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} disabled={busy} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-left text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-60">
            {busy ? <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden /> : <FileText size={14} className="shrink-0 text-gray-500" aria-hidden />}
            <span className="truncate">{label}</span>
            <ExternalLink size={12} className="shrink-0 text-gray-400" aria-hidden />
        </button>
    );
}

function Consultation({ c, opening, open }: { c: AdminPatientRecord['consultations'][number]; opening: string | null; open: (kind: SharedItemKind, id: string) => void }) {
    const info = statusInfo(c.status);
    const paid = c.payments.filter((p) => p.status === 'CAPTURED');
    return (
        <details className="rounded-lg border border-gray-200 p-3">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                    <span className="block font-medium text-gray-900">{formatIstDateTime(c.startsAt)} · {c.doctor.displayName}</span>
                    <span className="block text-xs text-gray-500">{c.doctor.specialty.name}{c.note?.diagnosis ? ` · ${c.note.diagnosis}` : ''}{c.recordSharedAt ? ' · record shared' : ''}</span>
                </span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{info.label}</span>
            </summary>
            <div className="mt-3 grid gap-4 text-sm lg:grid-cols-2">
                <div className="space-y-2">
                    <p className="font-medium text-gray-900">Notes</p>
                    {c.note ? (
                        <dl className="space-y-1 text-gray-800">
                            {(['complaints', 'findings', 'diagnosis', 'advice'] as const).filter((k) => c.note?.[k]).map((k) => (
                                <div key={k}><dt className="inline font-medium capitalize">{k}: </dt><dd className="inline whitespace-pre-line">{c.note?.[k]}</dd></div>
                            ))}
                            {c.note.followUpDays ? <p className="text-gray-500">Follow-up in {c.note.followUpDays} days</p> : null}
                        </dl>
                    ) : <p className="text-gray-500">No notes.</p>}
                    {c.cancelReason && <p className="text-gray-700">Cancelled{c.cancelledBy ? ` by ${c.cancelledBy.toLowerCase()}` : ''}: {c.cancelReason}</p>}
                    {c.attachments.length > 0 && (
                        <div className="space-y-1">
                            <p className="font-medium text-gray-900">Files attached to the booking</p>
                            <div className="flex flex-wrap gap-2">{c.attachments.map((f) => <OpenButton key={f.id} label={f.name} busy={opening === f.id} onClick={() => open('attachments', f.id)} />)}</div>
                        </div>
                    )}
                    <div className="space-y-1">
                        <p className="font-medium text-gray-900">Money</p>
                        <p className="text-gray-800">
                            Fee {formatPaise(c.feePaise)}{c.discountPaise ? ` · promo ${c.promoCode ?? ''} −${formatPaise(c.discountPaise)}` : ''}{c.walletPaise ? ` · wallet ${formatPaise(c.walletPaise)}` : ''}
                        </p>
                        {c.payments.map((p) => (
                            <p key={p.id} className="text-gray-600">{p.source === 'WALLET' ? 'Wallet' : 'Card/UPI'} {formatPaise(p.amountPaise)} · {p.status}{p.razorpayPaymentId ? ` · ${p.razorpayPaymentId}` : ''}</p>
                        ))}
                        {c.refunds.map((r) => (
                            <p key={r.id} className="text-gray-600">Refund {formatPaise(r.amountPaise)} · {r.reason} · {r.status} · {formatIstDay(r.createdAt)}</p>
                        ))}
                        {!paid.length && !c.refunds.length && <p className="text-gray-500">Nothing paid.</p>}
                    </div>
                </div>
                <div className="space-y-2">
                    <p className="font-medium text-gray-900">Prescription</p>
                    {c.prescription ? <PrescriptionView prescription={c.prescription} /> : <p className="text-gray-500">None issued.</p>}
                    {c.voidedPrescriptions.length > 0 && (
                        <p className="text-xs text-gray-500">Earlier versions: {c.voidedPrescriptions.map((v) => `v${v.version} voided ${formatIstDay(v.voidedAt)}${v.voidReason ? ` (${v.voidReason})` : ''}`).join('; ')}</p>
                    )}
                </div>
            </div>
        </details>
    );
}

/** Super admin: one person's whole health record. Loading it and opening any file is audit-logged. */
export default function AdminPatientRecordPage() {
    const { id } = useParams<{ id: string }>();
    const { data, error, loading } = useApi(() => adminApi.patientRecord(id), [id]);
    const [opening, setOpening] = useState<string | null>(null);
    const [openError, setOpenError] = useState<string | null>(null);

    async function open(kind: SharedItemKind, targetId: string) {
        setOpening(targetId);
        setOpenError(null);
        // Made inside the click so pop-up blockers allow it; filled in once the logged link is back.
        const win = window.open('', '_blank');
        try {
            const link = await adminApi.openPatientFile(id, kind, targetId);
            const url = link.kind === 'report' ? getApiUrl(`/reports/public/${link.viewToken}`) : link.url;
            if (win) {
                win.opener = null;
                win.location.href = url;
            } else window.location.assign(url);
        } catch (e) {
            win?.close();
            setOpenError(errorMessage(e, 'This file could not be opened.'));
        } finally {
            setOpening(null);
        }
    }

    if (loading && !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" aria-label="Loading record" /></div>;
    if (!data) return <div className="p-6"><p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error ?? 'Record not found'}</p></div>;

    const p = data.person;
    /** "(latest 100 of 130)" when a list stops short. */
    const capped = (shown: number, total: number) => (total > shown ? ` (latest ${shown} of ${total})` : '');
    const files = (list: SharedFile[], kind: SharedItemKind) => (
        <div className="flex flex-wrap gap-2">{list.map((f) => <OpenButton key={f.id} label={`${f.name} · ${formatIstDay(f.uploadedAt)}`} busy={opening === f.id} onClick={() => void open(kind, f.id)} />)}</div>
    );

    return (
        <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
                <Link href={`/super-admin/users/${data.account.id}`} className="rounded-lg p-2 hover:bg-gray-100" aria-label="Back to the account"><ArrowLeft size={20} /></Link>
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold text-gray-900">{p.name}</h1>
                    <p className="text-sm text-gray-500">
                        {p.relation} · {p.age} years · {p.gender} · account {data.account.name || 'No name'}{data.account.deleted ? ' (deleted)' : data.account.mobile ? ` · ${data.account.mobile}` : ''}
                    </p>
                </div>
            </div>
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden /> This view and every file you open are recorded in the audit log under your name.
            </p>
            {openError && <p role="alert" className="text-sm font-medium text-red-700">{openError}</p>}

            <section className={card} aria-label="Health details">
                <h2 className={h2}>Health details</h2>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="flex items-center gap-1 font-medium text-red-700"><AlertTriangle size={14} aria-hidden /> Allergies</dt><dd><Tags items={p.allergies} warn empty={p.allergiesConfirmedAt ? 'No known allergies' : 'Not confirmed'} /></dd></div>
                    <div><dt className="font-medium text-gray-900">Conditions</dt><dd><Tags items={p.chronicConditions} empty="None recorded" /></dd></div>
                    <div><dt className="font-medium text-gray-900">Current medicines</dt><dd><Tags items={p.currentMedications} empty="None recorded" /></dd></div>
                    <div><dt className="font-medium text-gray-900">Blood group</dt><dd className="text-gray-800">{p.bloodGroup ?? 'Not recorded'}</dd></div>
                </dl>
            </section>

            <section className={card} aria-label="Consultations">
                <h2 className={h2}>Consultations ({data.consultations.length}){capped(data.consultations.length, data.totals.consultations)}</h2>
                {data.consultations.length ? <div className="space-y-2">{data.consultations.map((c) => <Consultation key={c.id} c={c} opening={opening} open={(k, t) => void open(k, t)} />)}</div>
                    : <p className="text-sm text-gray-500">No consultations.</p>}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
                <section className={card} aria-label="Lab reports">
                    <h2 className={h2}>DocNow lab reports ({data.reports.length}){capped(data.reports.length, data.totals.reports)}</h2>
                    {data.reports.length ? (
                        <div className="flex flex-wrap gap-2">
                            {data.reports.map((r) => (
                                <button key={r.id} type="button" onClick={() => void open('reports', r.id)} disabled={opening === r.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-60">
                                    {opening === r.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <FlaskConical size={14} className="shrink-0 text-gray-500" aria-hidden />}
                                    <span className="truncate">{r.label} · {formatIstDay(r.date)}{r.isFullReport ? '' : ' (partial)'}</span>
                                </button>
                            ))}
                        </div>
                    ) : <p className="text-sm text-gray-500">No lab reports.</p>}
                </section>
                <section className={card} aria-label="Medical files">
                    <h2 className={h2}>Medical files ({data.documents.length})</h2>
                    {data.documents.length ? files(data.documents, 'documents') : <p className="text-sm text-gray-500">No files uploaded.</p>}
                </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <section className={card} aria-label="Sharing consents">
                    <h2 className={h2}>Record sharing (patient&apos;s choices){capped(data.consents.length, data.totals.consents)}</h2>
                    {data.consents.length ? (
                        <ul className="space-y-1 text-sm text-gray-800">
                            {data.consents.map((c) => (
                                <li key={c.id}>{formatIstDateTime(c.createdAt)} · {c.granted ? 'Shared' : 'Stopped sharing'} · {c.channel === 'system' ? 'by DocNow (moved or account deleted)' : c.channel} · {c.version}</li>
                            ))}
                        </ul>
                    ) : <p className="text-sm text-gray-500">Never shared.</p>}
                </section>
                <section className={card} aria-label="Doctor access log">
                    <h2 className={h2}>Doctors who opened the record{capped(data.accessLog.length, data.totals.accessLog)}</h2>
                    {data.accessLog.length ? (
                        <ul className="space-y-1 text-sm text-gray-800">
                            {data.accessLog.map((a) => <li key={a.id}>{formatIstDateTime(a.at)} · {a.doctorName} · {ACTION_LABEL[a.action] ?? a.action}</li>)}
                        </ul>
                    ) : <p className="text-sm text-gray-500">No doctor has opened it.</p>}
                </section>
            </div>
        </div>
    );
}
