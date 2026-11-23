'use client';
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Notice } from '@/components/ui';
import { Field, PageHeader, inputCls } from '@/components/admin/consult/shared';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { errorMessage, manager } from '@/lib/consult/api';
import { formatIstDateTime } from '@/lib/consult/time';
import type { AttendanceCounts, AttendanceReport, AttendanceSide } from '@/lib/consult/types';
import { cn } from '@/lib/utils';

const DAY_MS = 24 * 3_600_000;
/** The IST calendar day `daysAgo` days back, as YYYY-MM-DD (what <input type="date"> uses). */
const istDay = (daysAgo: number, now = Date.now()) => new Date(now - daysAgo * DAY_MS + 330 * 60_000).toISOString().slice(0, 10);

function outcomeText(side: AttendanceSide) {
    switch (side.outcome) {
        case 'NO_SHOW': return 'No-show';
        case 'LATE': return `Late (${side.minutesLate} min)`;
        case 'ON_TIME': return 'On time';
        default: return 'Did not join';
    }
}

function Outcome({ side }: { side: AttendanceSide }) {
    const tone = side.outcome === 'NO_SHOW' ? 'font-semibold text-red-700' : side.outcome === 'LATE' ? 'font-semibold text-amber-700' : 'text-gray-500';
    return <span className={tone}>{outcomeText(side)}</span>;
}

function Tile({ label, value, sub, alert }: { label: string; value: number; sub?: string; alert?: boolean }) {
    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={cn('mt-1 text-2xl font-bold', alert && value > 0 ? 'text-red-600' : 'text-gray-900')}>{value}</p>
            {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
        </div>
    );
}

const avgLate = (c: AttendanceCounts) => (c.avgMinutesLate === null ? undefined : `${c.avgMinutesLate} min late on average`);
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500';
const td = 'px-3 py-2 align-top';

function Table({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
            <h2 className="px-4 pt-4 text-lg font-semibold text-gray-900">{caption}</h2>
            {/* Wide tables scroll inside the card, never the page. */}
            <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                    <thead className="border-b border-gray-100"><tr>{head.map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-gray-50">{children}</tbody>
                </table>
            </div>
        </section>
    );
}

const count = (n: number, alert = false) => <span className={alert && n > 0 ? 'font-bold text-red-600' : undefined}>{n}</span>;

function Report({ report }: { report: AttendanceReport }) {
    const { totals } = report;
    if (totals.consultations === 0) {
        return <EmptyState title="No consultations in these dates" body="Consultations that took place or were missed show up here." />;
    }
    return (
        <div className="space-y-6">
            {report.truncated && (
                <Notice tone="warning" title="Too many consultations for one report">The numbers below are partial. Pick a shorter range.</Notice>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Tile label="Consultations due" value={totals.consultations} />
                <Tile label="Doctor no-shows" value={totals.doctor.noShows} alert />
                <Tile label="Doctors late" value={totals.doctor.late} sub={avgLate(totals.doctor)} />
                <Tile label="Patient no-shows" value={totals.patient.noShows} alert />
                <Tile label="Patients late" value={totals.patient.late} sub={avgLate(totals.patient)} />
            </div>

            <Table caption="By doctor" head={['Doctor', 'Consultations', 'No-shows', 'Late', 'Average lateness']}>
                {report.doctors.map((d) => (
                    <tr key={d.doctorId}>
                        <td className={cn(td, 'font-medium text-gray-900')}>{d.name}</td>
                        <td className={td}>{d.consultations}</td>
                        <td className={td}>{count(d.noShows, true)}</td>
                        <td className={td}>{count(d.late)}</td>
                        <td className={td}>{d.avgMinutesLate === null ? '-' : `${d.avgMinutesLate} min`}</td>
                    </tr>
                ))}
            </Table>

            {report.patients.length > 0 && (
                <Table caption="By patient (only those who missed or were late)" head={['Patient', 'Booked by', 'Consultations', 'No-shows', 'Late']}>
                    {report.patients.map((p) => (
                        <tr key={p.patientId}>
                            <td className={cn(td, 'font-medium text-gray-900')}>{p.name}</td>
                            <td className={td}>{p.mobile ?? <span className="text-gray-400">Deleted account</span>}</td>
                            <td className={td}>{p.consultations}</td>
                            <td className={td}>{count(p.noShows, true)}</td>
                            <td className={td}>{count(p.late)}</td>
                        </tr>
                    ))}
                </Table>
            )}

            {report.issues.length > 0 && (
                <Table
                    caption={report.issuesTotal > report.issues.length
                        ? `Consultations with a no-show or late join (newest ${report.issues.length} of ${report.issuesTotal}; Export CSV for all)`
                        : 'Consultations with a no-show or late join'}
                    head={['When (IST)', 'Doctor', 'Patient', 'Doctor joined', 'Patient joined']}
                >
                    {report.issues.map((r) => (
                        <tr key={r.consultationId}>
                            <td className={cn(td, 'whitespace-nowrap')}>{formatIstDateTime(r.startsAt)}</td>
                            <td className={td}>{r.doctorName}</td>
                            <td className={td}>{r.patientName}</td>
                            <td className={td}><Outcome side={r.doctor} /></td>
                            <td className={td}><Outcome side={r.patient} /></td>
                        </tr>
                    ))}
                </Table>
            )}
        </div>
    );
}

/** Manager portal: consultation no-shows and late joins, per doctor and per patient, for a date range. */
export function ConsultAttendance() {
    const [range, setRange] = useState(() => ({ from: istDay(29), to: istDay(0) }));
    const [exporting, setExporting] = useState(false);
    const valid = !!range.from && !!range.to && range.from <= range.to;
    const report = useApi(() => (valid ? manager.attendance(range) : Promise.resolve(null)), [range.from, range.to]);

    async function exportCsv() {
        setExporting(true);
        try {
            await manager.downloadAttendanceCsv(range);
        } catch (e) {
            toast.error(errorMessage(e, 'Could not download the CSV'));
        } finally {
            setExporting(false);
        }
    }

    const lateAfter = report.data?.lateAfterMinutes ?? 5;
    return (
        <div className="mx-auto max-w-[1100px]">
            <PageHeader
                title="Consult no-shows and late joins"
                subtitle={`Late means joining more than ${lateAfter} minutes after the start. Dates and times are IST.`}
                action={
                    <Button variant="outline" onClick={exportCsv} disabled={!valid || exporting}>
                        {exporting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} aria-hidden />}
                        Export CSV
                    </Button>
                }
            />
            <div className="mb-6 grid max-w-md grid-cols-2 gap-3">
                <Field label="From" htmlFor="from">
                    <input id="from" type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={inputCls} />
                </Field>
                <Field label="To" htmlFor="to">
                    <input id="to" type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={inputCls} />
                </Field>
            </div>
            {!valid ? <Notice tone="warning">Pick a start date on or before the end date.</Notice>
                : report.loading ? <LoadingBlock label="Loading the report" />
                : report.error ? <ErrorState message={report.error} onRetry={report.refetch} />
                : report.data ? <Report report={report.data} />
                : null}
            <p className="mt-6 text-xs text-gray-500">
                A doctor no-show includes a patient who cancelled for a full refund because the doctor was late. Not counted yet: a late doctor&apos;s
                consultation that the patient moved to another time or another doctor.
            </p>
        </div>
    );
}
