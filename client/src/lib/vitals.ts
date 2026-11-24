/**
 * P8 vitals tracker: blood pressure, blood sugar and period logs per person (self or family).
 * Pure rules here, kept apart from React so they can be tested. The limits are what is physically
 * possible, not a "normal" range, and must match the server (consultations.vitals.ts). DocNow shows
 * no medical advice on these screens: only the numbers, their trend and a labelled period estimate.
 */
import type { AxiosResponse } from 'axios';
import api from '@/lib/api';

export type VitalKind = 'BP' | 'SUGAR';
export type SugarTiming = 'FASTING' | 'BEFORE_MEAL' | 'AFTER_MEAL' | 'RANDOM';
export type PeriodFlow = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export const RANGE_DAYS = [30, 90, 365] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

export const LIMITS = {
    systolic: { min: 50, max: 300 },
    diastolic: { min: 30, max: 200 },
    pulse: { min: 25, max: 250 },
    glucoseMgDl: { min: 20, max: 1000 },
} as const;
export const MAX_PERIOD_DAYS = 15;

export const SUGAR_TIMING_LABEL: Record<SugarTiming, string> = {
    FASTING: 'Fasting',
    BEFORE_MEAL: 'Before a meal',
    AFTER_MEAL: 'After a meal',
    RANDOM: 'Random',
};
export const FLOW_LABEL: Record<PeriodFlow, string> = { LIGHT: 'Light', MEDIUM: 'Medium', HEAVY: 'Heavy' };
export const SYMPTOM_LABEL = {
    CRAMPS: 'Cramps',
    HEADACHE: 'Headache',
    BACK_PAIN: 'Back pain',
    BLOATING: 'Bloating',
    TENDER_BREASTS: 'Tender breasts',
    MOOD_CHANGES: 'Mood changes',
    ACNE: 'Acne',
    FATIGUE: 'Tiredness',
    NAUSEA: 'Nausea',
} as const;
export type PeriodSymptom = keyof typeof SYMPTOM_LABEL;

export interface VitalReading {
    id: string;
    kind: VitalKind;
    systolic: number | null;
    diastolic: number | null;
    pulse: number | null;
    glucoseMgDl: number | null;
    sugarTiming: SugarTiming | null;
    measuredAt: string;
    note: string | null;
}

export interface PeriodLog {
    id: string;
    startDate: string;
    endDate: string | null;
    flow: PeriodFlow | null;
    symptoms: PeriodSymptom[];
}

export interface PeriodEstimate {
    nextStart: string;
    averageCycleDays: number;
    cyclesUsed: number;
    passed: boolean;
}

/** The vitals part of a doctor's shared record or the super-admin record (older servers leave it out). */
export interface RecordVitals {
    /** IST day (YYYY-MM-DD) from which readings are included. */
    since: string;
    /** How many there are in all; the lists hold the latest ones only. */
    totals?: { bp: number; sugar: number; periods: number };
    bp: VitalReading[];
    sugar: VitalReading[];
    periods: PeriodLog[];
    periodEstimate: PeriodEstimate | null;
}

const data = <T,>(res: AxiosResponse<T>) => res.data;

export const vitalsApi = {
    readings: (patientId: string, kind: VitalKind, days: RangeDays) =>
        api.get<{ kind: VitalKind; days: number; readings: VitalReading[]; total: number; limit: number }>(`/consult/vitals/${patientId}/readings`, { params: { kind, days } }).then(data),
    addReading: (patientId: string, body: Record<string, unknown>) => api.post<VitalReading>(`/consult/vitals/${patientId}/readings`, body).then(data),
    removeReading: (id: string) => api.delete<{ id: string; removed: boolean }>(`/consult/vitals/readings/${id}`).then(data),
    periods: (patientId: string) => api.get<{ logs: PeriodLog[]; estimate: PeriodEstimate | null }>(`/consult/vitals/${patientId}/periods`).then(data),
    addPeriod: (patientId: string, body: Record<string, unknown>) => api.post<PeriodLog>(`/consult/vitals/${patientId}/periods`, body).then(data),
    editPeriod: (id: string, body: Record<string, unknown>) => api.patch<PeriodLog>(`/consult/vitals/periods/${id}`, body).then(data),
    removePeriod: (id: string) => api.delete<{ id: string; removed: boolean }>(`/consult/vitals/periods/${id}`).then(data),
};

// ── Dates (IST calendar days) ───────────────────────────

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Today's IST day as YYYY-MM-DD. */
export const istToday = (now = new Date()) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** "24 Nov 2026" for a YYYY-MM-DD day (no time zone shift). */
export function formatDay(day: string) {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "24 Nov, 8:30 am" in IST. */
export function formatReadingTime(iso: string) {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/** The value of a datetime-local input for "now" in IST. */
export const istNowInput = (now = new Date()) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 16);
/** A datetime-local value typed in IST, as an ISO instant. */
export const istInputToIso = (v: string) => new Date(`${v}:00+05:30`).toISOString();

// ── Form checks (same limits as the server; the server checks again) ──

export interface BpForm { systolic: string; diastolic: string; pulse: string; measuredAt: string; note: string }
export interface SugarForm { glucoseMgDl: string; sugarTiming: SugarTiming | ''; measuredAt: string; note: string }

function wholeIn(raw: string, name: string, l: { min: number; max: number }, unit: string): { value?: number; error?: string } {
    const t = raw.trim();
    if (!/^\d+$/.test(t)) return { error: `Enter the ${name} as a whole number` };
    const v = Number(t);
    if (v < l.min || v > l.max) return { error: `The ${name} must be between ${l.min} and ${l.max} ${unit}` };
    return { value: v };
}

function whenError(v: string, now: Date) {
    if (!v) return 'Enter when it was measured';
    const at = Date.parse(istInputToIso(v));
    if (Number.isNaN(at)) return 'Enter when it was measured';
    if (at > now.getTime() + 5 * 60_000) return 'The time of a reading cannot be in the future';
    return null;
}

/** The POST body, or the first problem in words. */
export function bpBody(f: BpForm, now = new Date()): { body?: Record<string, unknown>; error?: string } {
    const s = wholeIn(f.systolic, 'upper (systolic) number', LIMITS.systolic, 'mmHg');
    if (s.error) return { error: s.error };
    const d = wholeIn(f.diastolic, 'lower (diastolic) number', LIMITS.diastolic, 'mmHg');
    if (d.error) return { error: d.error };
    if (s.value! <= d.value!) return { error: 'The upper number must be higher than the lower one' };
    let pulse: number | null = null;
    if (f.pulse.trim()) {
        const p = wholeIn(f.pulse, 'pulse', LIMITS.pulse, 'beats a minute');
        if (p.error) return { error: p.error };
        pulse = p.value!;
    }
    const w = whenError(f.measuredAt, now);
    if (w) return { error: w };
    return { body: { kind: 'BP', systolic: s.value, diastolic: d.value, pulse, measuredAt: istInputToIso(f.measuredAt), note: f.note.trim() || undefined } };
}

export function sugarBody(f: SugarForm, now = new Date()): { body?: Record<string, unknown>; error?: string } {
    const g = wholeIn(f.glucoseMgDl, 'sugar value', LIMITS.glucoseMgDl, 'mg/dL');
    if (g.error) return { error: g.error };
    if (!f.sugarTiming) return { error: 'Choose when it was measured: fasting, before a meal, after a meal or random' };
    const w = whenError(f.measuredAt, now);
    if (w) return { error: w };
    return { body: { kind: 'SUGAR', glucoseMgDl: g.value, sugarTiming: f.sugarTiming, measuredAt: istInputToIso(f.measuredAt), note: f.note.trim() || undefined } };
}

export function periodError(startDate: string, endDate: string, today: string): string | null {
    if (!startDate) return 'Enter the day the period started';
    if (startDate > today) return 'A period cannot start in the future';
    if (!endDate) return null;
    if (endDate < startDate) return 'The end date cannot be before the start date';
    if (endDate > today) return 'The end date cannot be in the future';
    if (daysBetween(startDate, endDate) + 1 > MAX_PERIOD_DAYS) return `A period log can cover at most ${MAX_PERIOD_DAYS} days`;
    return null;
}

// ── Display ─────────────────────────────────────────────

export const readingValue = (r: VitalReading) =>
    r.kind === 'BP' ? `${r.systolic}/${r.diastolic} mmHg` : `${r.glucoseMgDl} mg/dL`;

export function readingDetail(r: VitalReading) {
    return [r.kind === 'BP' ? (r.pulse ? `Pulse ${r.pulse}` : '') : r.sugarTiming ? SUGAR_TIMING_LABEL[r.sugarTiming] : '', r.note ?? ''].filter(Boolean).join(' · ');
}

/** Chart points, oldest first. */
export function chartPoints(readings: VitalReading[]) {
    return [...readings]
        .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
        .map((r) => ({ t: Date.parse(r.measuredAt), systolic: r.systolic, diastolic: r.diastolic, glucose: r.glucoseMgDl, timing: r.sugarTiming }));
}

/** How many days a log covers so far (a period still going counts up to today, at most 15). */
export function periodDays(p: Pick<PeriodLog, 'startDate' | 'endDate'>, today: string) {
    const end = p.endDate ?? (today < p.startDate ? p.startDate : today);
    return Math.min(daysBetween(p.startDate, end) + 1, MAX_PERIOD_DAYS);
}

/** Every logged day in a month grid: day → 'period'; the estimated start → 'estimate'. */
export function calendarMarks(logs: PeriodLog[], estimate: PeriodEstimate | null, today: string) {
    const marks = new Map<string, 'period' | 'estimate'>();
    for (const l of logs) {
        const n = periodDays(l, today);
        for (let i = 0; i < n; i++) marks.set(addDays(l.startDate, i), 'period');
    }
    if (estimate && !marks.has(estimate.nextStart)) marks.set(estimate.nextStart, 'estimate');
    return marks;
}

/** The days of a month view (Monday first), with blanks before the 1st. `month` is YYYY-MM. */
export function monthGrid(month: string): (string | null)[] {
    const first = new Date(`${month}-01T00:00:00Z`);
    const lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
}

export function shiftMonth(month: string, by: number) {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + by);
    return d.toISOString().slice(0, 7);
}

/** Periods matter for women and people who chose "Other"; never hidden on the server side. */
export const tracksPeriods = (gender: string | undefined) => (gender ?? '').trim().toLowerCase() !== 'male';
