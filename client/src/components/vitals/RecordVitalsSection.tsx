'use client';
import { Activity, CalendarDays, Droplet } from 'lucide-react';
import { VitalsChart } from './VitalsChart';
import { FLOW_LABEL, SYMPTOM_LABEL, formatDay, formatReadingTime, readingDetail, readingValue, type RecordVitals, type VitalReading } from '@/lib/vitals';

/**
 * Read-only vitals for a doctor's shared record or the super-admin record: the latest reading of
 * each kind, the trend, and the period logs with the patient's estimate. Numbers only.
 */
function Readings({ title, icon, readings, kind }: { title: string; icon: React.ReactNode; readings: VitalReading[]; kind: 'BP' | 'SUGAR' }) {
    if (!readings.length) return null;
    const latest = readings[0];
    return (
        <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink">{icon} {title}</h4>
            <p className="text-sm text-ink">
                Latest <span className="font-semibold">{readingValue(latest)}</span>
                <span className="text-ink-muted"> · {formatReadingTime(latest.measuredAt)}{readingDetail(latest) ? ` · ${readingDetail(latest)}` : ''}</span>
            </p>
            {readings.length > 1 && <VitalsChart readings={readings} kind={kind} height={160} />}
            <details className="text-sm">
                <summary className="cursor-pointer font-medium text-primary">{readings.length === 1 ? 'Show the reading' : `All ${readings.length} readings`}</summary>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {readings.map((r) => (
                        <li key={r.id} className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5">
                            <span className="font-semibold text-ink">{readingValue(r)}</span>
                            <span className="text-ink-muted">{formatReadingTime(r.measuredAt)}{readingDetail(r) ? ` · ${readingDetail(r)}` : ''}</span>
                        </li>
                    ))}
                </ul>
            </details>
        </section>
    );
}

export function RecordVitalsSection({ vitals }: { vitals: RecordVitals | undefined }) {
    if (!vitals) return null;
    const empty = !vitals.bp.length && !vitals.sugar.length && !vitals.periods.length;
    const since = formatDay(vitals.since.slice(0, 10));
    return (
        <div className="space-y-4">
            <p className="text-xs text-ink-subtle">Typed in by the patient (not measured by DocNow). Readings since {since}.</p>
            {empty && <p className="text-sm text-ink-muted">No vitals logged.</p>}
            <Readings title="Blood pressure" icon={<Activity className="h-4 w-4" aria-hidden />} readings={vitals.bp} kind="BP" />
            <Readings title="Blood sugar" icon={<Droplet className="h-4 w-4" aria-hidden />} readings={vitals.sugar} kind="SUGAR" />
            {vitals.periods.length > 0 && (
                <section className="space-y-2">
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><CalendarDays className="h-4 w-4" aria-hidden /> Periods</h4>
                    {vitals.periodEstimate && (
                        <p className="text-sm text-ink-muted">
                            Average cycle {vitals.periodEstimate.averageCycleDays} days (last {vitals.periodEstimate.cyclesUsed} cycles). Patient&apos;s estimated next start: {formatDay(vitals.periodEstimate.nextStart)}.
                        </p>
                    )}
                    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                        {vitals.periods.map((p) => (
                            <li key={p.id} className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5">
                                <span className="font-semibold text-ink">{formatDay(p.startDate)}{p.endDate ? ` – ${formatDay(p.endDate)}` : ' (ongoing)'}</span>
                                <span className="text-ink-muted">{[p.flow ? FLOW_LABEL[p.flow] : '', p.symptoms.map((s) => SYMPTOM_LABEL[s] ?? s).join(', ')].filter(Boolean).join(' · ')}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
