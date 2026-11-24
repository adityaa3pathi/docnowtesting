'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/consult/ConfirmDialog';
import { Button, Field, Input } from '@/components/ui';
import { VitalsChart } from '@/components/vitals/VitalsChart';
import { errorMessage } from '@/lib/consult/api';
import { RECORD_ACCESS_DAYS } from '@/lib/consult/consent';
import { healthApi, isSelfPerson, type HealthPerson } from '@/lib/health';
import { cn } from '@/lib/utils';
import {
    FLOW_LABEL, LIMITS, MAX_PERIOD_DAYS, RANGE_DAYS, SUGAR_TIMING_LABEL, SYMPTOM_LABEL,
    bpBody, calendarMarks, daysBetween, formatDay, formatReadingTime, istNowInput, istToday, monthGrid, periodDays, periodError,
    readingDetail, readingValue, shiftMonth, sugarBody, tracksPeriods, vitalsApi,
    type PeriodEstimate, type PeriodFlow, type PeriodLog, type PeriodSymptom, type RangeDays, type SugarTiming, type VitalKind, type VitalReading,
} from '@/lib/vitals';

type View = VitalKind | 'PERIODS';

function sortPeople(list: HealthPerson[]) {
    return [...list].sort((a, b) => (isSelfPerson(a) === isSelfPerson(b) ? a.name.localeCompare(b.name) : isSelfPerson(a) ? -1 : 1));
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T | ''; onChange: (v: T) => void }) {
    return (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
            {options.map(([v, text]) => (
                <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={value === v}
                    onClick={() => onChange(v)}
                    className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', value === v ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-ink')}>
                    {text}
                </button>
            ))}
        </div>
    );
}

// ── Readings (BP or sugar) ──────────────────────────────

function ReadingForm({ kind, patientId, onSaved, onCancel }: { kind: VitalKind; patientId: string; onSaved: (r: VitalReading) => void; onCancel: () => void }) {
    const [bp, setBp] = useState({ systolic: '', diastolic: '', pulse: '', measuredAt: istNowInput(), note: '' });
    const [sugar, setSugar] = useState({ glucoseMgDl: '', sugarTiming: '' as SugarTiming | '', measuredAt: istNowInput(), note: '' });
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    async function save(e: React.FormEvent) {
        e.preventDefault();
        const out = kind === 'BP' ? bpBody(bp) : sugarBody(sugar);
        if (out.error) return setError(out.error);
        setSaving(true);
        setError(null);
        try {
            onSaved(await vitalsApi.addReading(patientId, out.body!));
        } catch (err) {
            setError(errorMessage(err, 'The reading could not be saved. Please try again.'));
        } finally {
            setSaving(false);
        }
    }

    const num = { inputMode: 'numeric' as const, pattern: '[0-9]*', autoComplete: 'off' };
    const f = kind === 'BP' ? bp : sugar;
    const setWhen = (v: string) => (kind === 'BP' ? setBp({ ...bp, measuredAt: v }) : setSugar({ ...sugar, measuredAt: v }));
    const setNote = (v: string) => (kind === 'BP' ? setBp({ ...bp, note: v }) : setSugar({ ...sugar, note: v }));
    return (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label={kind === 'BP' ? 'Add a blood pressure reading' : 'Add a blood sugar reading'}>
            {kind === 'BP' ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field label="Upper (systolic)" hint="mmHg">{(p) => <Input {...p} {...num} value={bp.systolic} onChange={(e) => setBp({ ...bp, systolic: e.target.value })} placeholder="120" />}</Field>
                    <Field label="Lower (diastolic)" hint="mmHg">{(p) => <Input {...p} {...num} value={bp.diastolic} onChange={(e) => setBp({ ...bp, diastolic: e.target.value })} placeholder="80" />}</Field>
                    <Field label="Pulse (optional)" hint="beats a minute" className="col-span-2 sm:col-span-1">{(p) => <Input {...p} {...num} value={bp.pulse} onChange={(e) => setBp({ ...bp, pulse: e.target.value })} placeholder="72" />}</Field>
                </div>
            ) : (
                <>
                    <Field label="Blood sugar" hint={`mg/dL, ${LIMITS.glucoseMgDl.min}–${LIMITS.glucoseMgDl.max}`}>{(p) => <Input {...p} {...num} value={sugar.glucoseMgDl} onChange={(e) => setSugar({ ...sugar, glucoseMgDl: e.target.value })} placeholder="100" className="sm:max-w-[200px]" />}</Field>
                    <div className="space-y-1.5">
                        <p className="text-sm font-medium text-ink">When was it measured?</p>
                        <Chips label="When was it measured" options={Object.entries(SUGAR_TIMING_LABEL) as [SugarTiming, string][]} value={sugar.sugarTiming} onChange={(v) => setSugar({ ...sugar, sugarTiming: v })} />
                    </div>
                </>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date and time">{(p) => <Input {...p} type="datetime-local" max={istNowInput()} value={f.measuredAt} onChange={(e) => setWhen(e.target.value)} />}</Field>
                <Field label="Note (optional)">{(p) => <Input {...p} maxLength={200} value={f.note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. after a walk" />}</Field>
            </div>
            {error && <p role="alert" className="text-sm font-semibold text-danger-ink">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                <Button type="submit" size="sm" loading={saving}>Save reading</Button>
            </div>
        </form>
    );
}

function ReadingsPanel({ kind, person }: { kind: VitalKind; person: HealthPerson }) {
    const [days, setDays] = useState<RangeDays>(90);
    const [readings, setReadings] = useState<VitalReading[] | null>(null);
    const [total, setTotal] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<VitalReading | null>(null);

    // Keyed by person and kind, so state starts fresh; a range change clears it in its handler.
    useEffect(() => {
        let alive = true;
        vitalsApi.readings(person.id, kind, days)
            .then((r) => { if (alive) { setReadings(r.readings); setTotal(r.total); } })
            .catch((e) => { if (alive) setError(errorMessage(e)); });
        return () => { alive = false; };
    }, [person.id, kind, days]);

    const name = kind === 'BP' ? 'blood pressure' : 'blood sugar';
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                    Show
                    <select value={days} onChange={(e) => { setReadings(null); setError(null); setDays(Number(e.target.value) as RangeDays); }} className="h-9 rounded-lg border border-border-strong bg-surface px-2 text-sm text-ink">
                        {RANGE_DAYS.map((d) => <option key={d} value={d}>{d === 365 ? 'Last year' : `Last ${d} days`}</option>)}
                    </select>
                </label>
                {!adding && <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add reading</Button>}
            </div>
            {adding && (
                <ReadingForm
                    kind={kind}
                    patientId={person.id}
                    onCancel={() => setAdding(false)}
                    onSaved={(r) => {
                        setAdding(false);
                        // Shown only when it falls inside the range on screen.
                        if (Date.parse(r.measuredAt) >= Date.now() - days * 86_400_000) {
                            setReadings((cur) => [r, ...(cur ?? [])].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)));
                            setTotal((t) => t + 1);
                        }
                    }}
                />
            )}
            {error && <p role="alert" className="text-sm font-semibold text-danger-ink">{error}</p>}
            {!readings ? (
                !error && <div className="flex justify-center py-8"><Loader2 className="animate-spin" aria-label={`Loading ${name} readings`} /></div>
            ) : readings.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-ink-muted">
                    No {name} readings in this period for {isSelfPerson(person) ? 'you' : person.name}. Add one from your home monitor or a check-up.
                </p>
            ) : (
                <>
                    <div className="rounded-xl border border-border bg-surface p-3"><VitalsChart readings={readings} kind={kind} /></div>
                    {total > readings.length && <p className="text-xs text-ink-subtle">Showing the latest {readings.length} of {total} readings.</p>}
                    <ul className="space-y-2" aria-label={`${name} readings`}>
                        {readings.map((r) => (
                            <li key={r.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-ink">{readingValue(r)}</p>
                                    <p className="truncate text-xs text-ink-muted">{formatReadingTime(r.measuredAt)}{readingDetail(r) ? ` · ${readingDetail(r)}` : ''}</p>
                                </div>
                                <button type="button" onClick={() => setRemoving(r)} className="inline-flex shrink-0 items-center rounded-lg px-2 py-1.5 text-danger-ink hover:bg-surface-subtle" aria-label={`Delete the reading ${readingValue(r)} of ${formatReadingTime(r.measuredAt)}`}>
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <ConfirmDialog
                open={removing !== null}
                title="Delete this reading?"
                description={removing ? `${readingValue(removing)} on ${formatReadingTime(removing.measuredAt)} is deleted for good.` : ''}
                confirmLabel="Delete"
                destructive
                onClose={() => setRemoving(null)}
                onConfirm={async () => {
                    if (!removing) return;
                    await vitalsApi.removeReading(removing.id);
                    setReadings((cur) => cur?.filter((x) => x.id !== removing.id) ?? cur);
                    setTotal((t) => Math.max(0, t - 1));
                    setRemoving(null);
                }}
            />
        </div>
    );
}

// ── Periods ─────────────────────────────────────────────

function PeriodForm({ patientId, editing, onSaved, onCancel }: { patientId: string; editing: PeriodLog | null; onSaved: (p: PeriodLog) => void; onCancel: () => void }) {
    const today = istToday();
    const [startDate, setStart] = useState(editing?.startDate ?? today);
    const [endDate, setEnd] = useState(editing?.endDate ?? '');
    const [flow, setFlow] = useState<PeriodFlow | ''>(editing?.flow ?? '');
    const [symptoms, setSymptoms] = useState<PeriodSymptom[]>(editing?.symptoms ?? []);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    async function save(e: React.FormEvent) {
        e.preventDefault();
        const problem = periodError(startDate, endDate, today);
        if (problem) return setError(problem);
        setSaving(true);
        setError(null);
        const body = { startDate, endDate: endDate || null, flow: flow || null, symptoms };
        try {
            onSaved(editing ? await vitalsApi.editPeriod(editing.id, body) : await vitalsApi.addPeriod(patientId, body));
        } catch (err) {
            setError(errorMessage(err, 'The period could not be saved. Please try again.'));
        } finally {
            setSaving(false);
        }
    }

    const toggle = (s: PeriodSymptom) => setSymptoms((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
    return (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label={editing ? 'Edit period' : 'Log a period'}>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Started on">{(p) => <Input {...p} type="date" max={today} value={startDate} onChange={(e) => setStart(e.target.value)} />}</Field>
                <Field label="Ended on" hint="Leave empty if it is still going">{(p) => <Input {...p} type="date" min={startDate} max={today} value={endDate} onChange={(e) => setEnd(e.target.value)} />}</Field>
            </div>
            <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink">Flow (optional)</p>
                <Chips label="Flow" options={Object.entries(FLOW_LABEL) as [PeriodFlow, string][]} value={flow} onChange={(v) => setFlow(v === flow ? '' : v)} />
            </div>
            <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink">Symptoms (optional)</p>
                <div className="flex flex-wrap gap-2">
                    {(Object.entries(SYMPTOM_LABEL) as [PeriodSymptom, string][]).map(([s, text]) => (
                        <button key={s} type="button" aria-pressed={symptoms.includes(s)} onClick={() => toggle(s)}
                            className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', symptoms.includes(s) ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-ink')}>
                            {text}
                        </button>
                    ))}
                </div>
            </div>
            {error && <p role="alert" className="text-sm font-semibold text-danger-ink">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                <Button type="submit" size="sm" loading={saving}>{editing ? 'Save changes' : 'Save period'}</Button>
            </div>
        </form>
    );
}

function EstimateLine({ estimate }: { estimate: PeriodEstimate | null }) {
    if (!estimate) {
        return <p className="text-sm text-ink-muted">Log at least three periods to see an estimate of the next one.</p>;
    }
    return (
        <div className="rounded-xl border border-border bg-primary-soft px-4 py-3 text-sm">
            <p className="font-semibold text-ink">
                {estimate.passed ? 'Estimated start was ' : 'Next period estimated around '}{formatDay(estimate.nextStart)}
            </p>
            <p className="text-ink-muted">
                {estimate.passed ? 'Log your period when it starts. ' : ''}An estimate from your average cycle of {estimate.averageCycleDays} days (last {estimate.cyclesUsed} cycles), not a medical prediction.
            </p>
        </div>
    );
}

function PeriodCalendar({ logs, estimate }: { logs: PeriodLog[]; estimate: PeriodEstimate | null }) {
    const today = istToday();
    const [month, setMonth] = useState(today.slice(0, 7));
    const marks = calendarMarks(logs, estimate, today);
    const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return (
        <div className="rounded-xl border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
                <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg p-1.5 hover:bg-surface-subtle" aria-label="Previous month"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                <p className="text-sm font-semibold text-ink" aria-live="polite">{title}</p>
                <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg p-1.5 hover:bg-surface-subtle" aria-label="Next month"><ChevronRight className="h-4 w-4" aria-hidden /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`Period calendar, ${title}`}>
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} className="py-1 font-semibold text-ink-subtle" aria-hidden>{d}</span>)}
                {monthGrid(month).map((d, i) => {
                    if (!d) return <span key={`b${i}`} />;
                    const mark = marks.get(d);
                    const label = `${formatDay(d)}${mark === 'period' ? ', period' : mark === 'estimate' ? ', estimated start' : ''}`;
                    return (
                        <span key={d} role="gridcell" aria-label={label}
                            className={cn('flex aspect-square items-center justify-center rounded-full text-sm',
                                mark === 'period' && 'bg-rose-600 font-semibold text-white',
                                mark === 'estimate' && 'border-2 border-dashed border-rose-600 font-semibold text-rose-700',
                                !mark && d === today && 'ring-1 ring-ink-subtle',
                                !mark && 'text-ink')}>
                            {Number(d.slice(8))}
                        </span>
                    );
                })}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-rose-600" aria-hidden /> Period</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-dashed border-rose-600" aria-hidden /> Estimated start</span>
            </div>
        </div>
    );
}

function PeriodsPanel({ person }: { person: HealthPerson }) {
    const [logs, setLogs] = useState<PeriodLog[] | null>(null);
    const [estimate, setEstimate] = useState<PeriodEstimate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<{ editing: PeriodLog | null } | null>(null);
    const [removing, setRemoving] = useState<PeriodLog | null>(null);
    const today = istToday();

    const load = () => vitalsApi.periods(person.id).then((r) => { setLogs(r.logs); setEstimate(r.estimate); });
    // Keyed by person, so state starts fresh.
    useEffect(() => {
        let alive = true;
        vitalsApi.periods(person.id)
            .then((r) => { if (alive) { setLogs(r.logs); setEstimate(r.estimate); } })
            .catch((e) => { if (alive) setError(errorMessage(e)); });
        return () => { alive = false; };
    }, [person.id]);

    const reload = () => load().catch((e) => setError(errorMessage(e)));
    // "Ended today" only fits a period that can still end today (a log covers at most 15 days); older open logs are closed through Edit.
    const ongoing = logs?.find((l) => !l.endDate && daysBetween(l.startDate, today) < MAX_PERIOD_DAYS);

    return (
        <div className="space-y-3">
            {error && <p role="alert" className="text-sm font-semibold text-danger-ink">{error}</p>}
            {!logs ? (
                !error && <div className="flex justify-center py-8"><Loader2 className="animate-spin" aria-label="Loading periods" /></div>
            ) : (
                <>
                    <EstimateLine estimate={estimate} />
                    <div className="flex flex-wrap justify-end gap-2">
                        {ongoing && !form && (
                            <Button size="sm" variant="secondary" onClick={async () => {
                                try { await vitalsApi.editPeriod(ongoing.id, { endDate: today }); await reload(); } catch (e) { setError(errorMessage(e)); }
                            }}>Period ended today</Button>
                        )}
                        {!form && <Button size="sm" onClick={() => setForm({ editing: null })}><Plus className="h-4 w-4" aria-hidden /> Log period</Button>}
                    </div>
                    {form && (
                        <PeriodForm
                            key={form.editing?.id ?? 'new'}
                            patientId={person.id}
                            editing={form.editing}
                            onCancel={() => setForm(null)}
                            onSaved={async () => { setForm(null); await reload(); }}
                        />
                    )}
                    <PeriodCalendar logs={logs} estimate={estimate} />
                    {logs.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">No periods logged yet for {isSelfPerson(person) ? 'you' : person.name}.</p>
                    ) : (
                        <ul className="space-y-2" aria-label="Logged periods">
                            {logs.map((l) => (
                                <li key={l.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-ink">
                                            {formatDay(l.startDate)}{l.endDate ? ` – ${formatDay(l.endDate)}` : ' · still going'}
                                        </p>
                                        {/* Wraps instead of truncating: symptoms stay readable at 375 px. */}
                                        <p className="break-words text-xs text-ink-muted">
                                            {[`${periodDays(l, today)} ${periodDays(l, today) === 1 ? 'day' : 'days'}`, l.flow ? FLOW_LABEL[l.flow] : '', l.symptoms.map((s) => SYMPTOM_LABEL[s]).join(', ')].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                    <Button size="sm" variant="ghost" onClick={() => setForm({ editing: l })} aria-label={`Edit the period from ${formatDay(l.startDate)}`}>Edit</Button>
                                    <button type="button" onClick={() => setRemoving(l)} className="inline-flex shrink-0 items-center rounded-lg px-2 py-1.5 text-danger-ink hover:bg-surface-subtle" aria-label={`Delete the period from ${formatDay(l.startDate)}`}>
                                        <Trash2 className="h-4 w-4" aria-hidden />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
            <ConfirmDialog
                open={removing !== null}
                title="Delete this period?"
                description={removing ? `The period from ${formatDay(removing.startDate)} is deleted for good.` : ''}
                confirmLabel="Delete"
                destructive
                onClose={() => setRemoving(null)}
                onConfirm={async () => {
                    if (!removing) return;
                    await vitalsApi.removePeriod(removing.id);
                    setRemoving(null);
                    await reload();
                }}
            />
        </div>
    );
}

// ── The tab ─────────────────────────────────────────────

/** Vitals tracker for the account holder and each family member. Numbers only, no medical advice. */
export function VitalsTab() {
    const [people, setPeople] = useState<HealthPerson[] | null>(null);
    const [personId, setPersonId] = useState<string | null>(null);
    const [view, setView] = useState<View>('BP');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                try { await healthApi.ensureSelf(); } catch { /* a thin profile can't make "Self" yet */ }
                const list = sortPeople(await healthApi.people());
                if (!alive) return;
                setPeople(list);
                setPersonId(list[0]?.id ?? null);
            } catch (e) {
                if (alive) setError(errorMessage(e));
            }
        })();
        return () => { alive = false; };
    }, []);

    if (!people) {
        return error
            ? <p role="alert" className="py-8 text-center text-sm text-danger-ink">{error}</p>
            : <div className="flex justify-center py-12"><Loader2 className="animate-spin" aria-label="Loading vitals" /></div>;
    }
    const person = people.find((p) => p.id === personId);
    const views: [View, string][] = [['BP', 'Blood pressure'], ['SUGAR', 'Blood sugar'], ...(person && tracksPeriods(person.gender) ? [['PERIODS', 'Periods'] as [View, string]] : [])];
    const shownView = views.some(([v]) => v === view) ? view : 'BP';

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-bold text-ink">Vitals</h2>
                <p className="text-sm text-ink-muted">
                    Keep your blood pressure, blood sugar and periods in one place. A doctor sees them only when you tick
                    “Share health record” for a consultation, and only until {RECORD_ACCESS_DAYS} days after it.
                </p>
            </div>
            {people.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">Complete your profile first, then add your vitals here.</p>}
            {people.length > 1 && (
                <Chips label="Whose vitals" options={people.map((p) => [p.id, isSelfPerson(p) ? `${p.name} (you)` : `${p.name} · ${p.relation}`] as [string, string])} value={personId ?? ''} onChange={setPersonId} />
            )}
            {person && (
                <>
                    <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1" role="tablist" aria-label="Kind of vitals">
                        {views.map(([v, label]) => (
                            <button key={v} type="button" role="tab" aria-selected={shownView === v} onClick={() => setView(v)}
                                className={cn('flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold', shownView === v ? 'bg-surface text-primary shadow-sm' : 'text-ink-muted')}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <div role="tabpanel">
                        {shownView === 'PERIODS'
                            ? <PeriodsPanel key={person.id} person={person} />
                            : <ReadingsPanel key={`${person.id}-${shownView}`} kind={shownView} person={person} />}
                    </div>
                </>
            )}
        </div>
    );
}
