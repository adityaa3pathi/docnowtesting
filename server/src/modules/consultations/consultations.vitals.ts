/**
 * P8 vitals tracker: blood pressure, blood sugar and period logs, kept per person (self or family).
 *
 * - Only the owning account adds, lists and deletes them, like the medical records vault.
 * - Values are checked against what is physically possible, never against a "normal" range: DocNow
 *   shows no medical advice here, only the numbers and their trend.
 * - Periods: logging plus a simple next-start estimate from the average of recent cycles, labelled
 *   as an estimate (no fertility or ovulation predictions). Aditya, 2026-11-24.
 * - Doctors see vitals only inside the P7 shared health record (opt-in per booking, until 7 days
 *   after the visit, every view logged), through vitalsForRecord.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';
import { istDayStart } from './slots';

const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

export const VITAL_KINDS = ['BP', 'SUGAR'] as const;
export type VitalKind = (typeof VITAL_KINDS)[number];
export const SUGAR_TIMINGS = ['FASTING', 'BEFORE_MEAL', 'AFTER_MEAL', 'RANDOM'] as const;
export const PERIOD_FLOWS = ['LIGHT', 'MEDIUM', 'HEAVY'] as const;
export const PERIOD_SYMPTOMS = ['CRAMPS', 'HEADACHE', 'BACK_PAIN', 'BLOATING', 'TENDER_BREASTS', 'MOOD_CHANGES', 'ACNE', 'FATIGUE', 'NAUSEA'] as const;

/** Physically possible values (not "normal" ones). Must match the DB CHECK and the client form. */
export const LIMITS = {
    systolic: { min: 50, max: 300 },
    diastolic: { min: 30, max: 200 },
    pulse: { min: 25, max: 250 },
    glucoseMgDl: { min: 20, max: 1000 },
} as const;
/** Readings can be backdated this far; a clock a little ahead is allowed. */
export const MAX_BACKDATE_DAYS = 5 * 365;
const FUTURE_SKEW_MS = 5 * 60_000;
/** A period log covers at most this many days, start and end included. */
export const MAX_PERIOD_DAYS = 15;
export const MAX_PERIOD_BACKDATE_DAYS = 3 * 365;
/** Readings returned per kind; the list and chart show the latest ones. */
export const MAX_READINGS = 500;
export const RANGE_DAYS = [30, 90, 365] as const;

// ── Shapes and checks ───────────────────────────────────

const whole = (name: string, l: { min: number; max: number }, unit: string) =>
    z.number({ error: `Enter the ${name}` }).int(`Enter the ${name} as a whole number`)
        .min(l.min, `The ${name} must be between ${l.min} and ${l.max} ${unit}`)
        .max(l.max, `The ${name} must be between ${l.min} and ${l.max} ${unit}`);

const when = z.coerce.date({ error: 'Enter when it was measured' });
const note = z.string().trim().max(200, 'Keep the note under 200 characters').optional().transform((v) => v || null);

export const readingSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('BP'),
        systolic: whole('upper (systolic) number', LIMITS.systolic, 'mmHg'),
        diastolic: whole('lower (diastolic) number', LIMITS.diastolic, 'mmHg'),
        pulse: whole('pulse', LIMITS.pulse, 'beats a minute').nullish(),
        measuredAt: when,
        note,
    }).refine((r) => r.systolic > r.diastolic, { message: 'The upper number must be higher than the lower one', path: ['diastolic'] }),
    z.object({
        kind: z.literal('SUGAR'),
        glucoseMgDl: whole('sugar value', LIMITS.glucoseMgDl, 'mg/dL'),
        sugarTiming: z.enum(SUGAR_TIMINGS, { error: 'Choose when it was measured: fasting, before a meal, after a meal or random' }),
        measuredAt: when,
        note,
    }),
], { error: 'Choose blood pressure or blood sugar' });
export type ReadingInput = z.infer<typeof readingSchema>;

const day = z.string({ error: 'Enter a date' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD')
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Enter a real date');
const periodFields = {
    endDate: day.nullish(),
    flow: z.enum(PERIOD_FLOWS, { error: 'Choose light, medium or heavy' }).nullish(),
    symptoms: z.array(z.enum(PERIOD_SYMPTOMS, { error: 'Unknown symptom' })).max(PERIOD_SYMPTOMS.length).optional(),
};
export const periodSchema = z.object({ startDate: day, ...periodFields });
/** Edits never carry defaults (Zod 4 applies .default() inside .partial()): only sent fields change. */
export const periodEditSchema = z.object({ startDate: day.optional(), ...periodFields });
export type PeriodInput = z.infer<typeof periodSchema>;
export type PeriodEdit = z.infer<typeof periodEditSchema>;

/** The IST calendar day of an instant, as YYYY-MM-DD. */
export const istDay = (d: Date) => new Date(istDayStart(d).getTime() + IST_MS).toISOString().slice(0, 10);
const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayString = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => dayString(new Date(dayDate(d).getTime() + n * DAY_MS));
const daysBetween = (a: string, b: string) => Math.round((dayDate(b).getTime() - dayDate(a).getTime()) / DAY_MS);

export function checkMeasuredAt(at: Date, now: Date) {
    if (at.getTime() > now.getTime() + FUTURE_SKEW_MS) throw new DoctorError(400, 'The time of a reading cannot be in the future');
    if (at.getTime() < now.getTime() - MAX_BACKDATE_DAYS * DAY_MS) throw new DoctorError(400, 'Readings can go back at most 5 years');
}

export function checkPeriodDates(startDate: string, endDate: string | null | undefined, now: Date) {
    const today = istDay(now);
    if (startDate > today) throw new DoctorError(400, 'A period cannot start in the future');
    if (daysBetween(startDate, today) > MAX_PERIOD_BACKDATE_DAYS) throw new DoctorError(400, 'Periods can go back at most 3 years');
    if (endDate == null) return;
    if (endDate < startDate) throw new DoctorError(400, 'The end date cannot be before the start date');
    if (endDate > today) throw new DoctorError(400, 'The end date cannot be in the future');
    if (daysBetween(startDate, endDate) + 1 > MAX_PERIOD_DAYS) throw new DoctorError(400, `A period log can cover at most ${MAX_PERIOD_DAYS} days`);
}

// ── Next-period estimate (pure) ─────────────────────────

/**
 * Gaps outside this range are treated as a missed or doubled log, not a cycle. The upper bound sits
 * below two short cycles (2 × 24 = 48 days), so one period left unlogged never doubles the average.
 */
export const CYCLE_DAYS = { min: 15, max: 45 } as const;
export const ESTIMATE_CYCLES = 6;
export const MIN_CYCLES_FOR_ESTIMATE = 2;

export interface PeriodEstimate {
    /** Estimated next start day (YYYY-MM-DD). An estimate, never a medical prediction. */
    nextStart: string;
    averageCycleDays: number;
    cyclesUsed: number;
    /** The estimated day is before today and no newer period was logged. */
    passed: boolean;
}

/**
 * Average of the latest cycles (start to next start), from at most ESTIMATE_CYCLES gaps that look
 * like real cycles. Needs MIN_CYCLES_FOR_ESTIMATE of them; otherwise null.
 */
export function estimateNextPeriod(startDates: string[], today: string): PeriodEstimate | null {
    const starts = [...new Set(startDates)].sort();
    const gaps: number[] = [];
    for (let i = 1; i < starts.length; i++) {
        const g = daysBetween(starts[i - 1], starts[i]);
        if (g >= CYCLE_DAYS.min && g <= CYCLE_DAYS.max) gaps.push(g);
    }
    const used = gaps.slice(-ESTIMATE_CYCLES);
    if (used.length < MIN_CYCLES_FOR_ESTIMATE) return null;
    const avg = Math.round(used.reduce((a, b) => a + b, 0) / used.length);
    const nextStart = addDays(starts[starts.length - 1], avg);
    return { nextStart, averageCycleDays: avg, cyclesUsed: used.length, passed: nextStart < today };
}

// ── Patient: readings ───────────────────────────────────

type Deps = { db?: PrismaClient; now?: () => Date };

async function ownPerson(db: Pick<PrismaClient, 'patient'>, userId: string, patientId: string) {
    const p = await db.patient.findFirst({ where: { id: patientId, userId }, select: { id: true } });
    if (!p) throw new DoctorError(404, 'Not found');
    return p;
}

const readingSelect = { id: true, kind: true, systolic: true, diastolic: true, pulse: true, glucoseMgDl: true, sugarTiming: true, measuredAt: true, note: true, source: true, createdAt: true } as const;

/** One person's readings of a kind within the last `days`, newest first (at most MAX_READINGS). */
export async function listReadings(userId: string, patientId: string, kind: VitalKind, days: number, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    await ownPerson(db, userId, patientId);
    const where = { patientId, kind, measuredAt: { gte: new Date(now.getTime() - days * DAY_MS) } };
    const [readings, total] = await Promise.all([
        db.vitalReading.findMany({ where, orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }], take: MAX_READINGS, select: readingSelect }),
        db.vitalReading.count({ where }),
    ]);
    return { kind, days, readings, total, limit: MAX_READINGS };
}

export async function addReading(userId: string, patientId: string, input: ReadingInput, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    await ownPerson(db, userId, patientId);
    checkMeasuredAt(input.measuredAt, now);
    const values = input.kind === 'BP'
        ? { systolic: input.systolic, diastolic: input.diastolic, pulse: input.pulse ?? null }
        : { glucoseMgDl: input.glucoseMgDl, sugarTiming: input.sugarTiming };
    return db.vitalReading.create({
        data: { userId, patientId, kind: input.kind, ...values, measuredAt: input.measuredAt, note: input.note, source: 'MANUAL' },
        select: readingSelect,
    });
}

export async function removeReading(userId: string, id: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const res = await db.vitalReading.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new DoctorError(404, 'Not found');
    return { id, removed: true };
}

// ── Patient: periods ────────────────────────────────────

type PeriodRow = { id: string; startDate: Date; endDate: Date | null; flow: string | null; symptoms: string[]; createdAt: Date; updatedAt: Date };
const periodView = (p: PeriodRow) => ({ id: p.id, startDate: dayString(p.startDate), endDate: p.endDate ? dayString(p.endDate) : null, flow: p.flow, symptoms: p.symptoms });
const periodSelect = { id: true, startDate: true, endDate: true, flow: true, symptoms: true, createdAt: true, updatedAt: true } as const;
export type PeriodView = ReturnType<typeof periodView>;

/** The days a log covers for overlap checks: a log still going covers up to today (at most 15 days). */
function coveredUntil(p: { startDate: string; endDate: string | null }, today: string) {
    if (p.endDate) return p.endDate;
    const cap = addDays(p.startDate, MAX_PERIOD_DAYS - 1);
    return today < cap ? (today < p.startDate ? p.startDate : today) : cap;
}

function overlaps(a: { startDate: string; endDate: string | null }, b: { startDate: string; endDate: string | null }, today: string) {
    return a.startDate <= coveredUntil(b, today) && b.startDate <= coveredUntil(a, today);
}

/** Every log of the person, newest first, and the next-start estimate. */
export async function listPeriods(userId: string, patientId: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    await ownPerson(db, userId, patientId);
    return periodsOf(db, patientId, now);
}

async function periodsOf(db: Pick<PrismaClient, 'periodLog'>, patientId: string, now: Date, take?: number) {
    const rows = await db.periodLog.findMany({ where: { patientId }, orderBy: { startDate: 'desc' }, take, select: periodSelect });
    const logs = rows.map(periodView);
    return { logs, estimate: estimateNextPeriod(logs.map((l) => l.startDate), istDay(now)) };
}

/**
 * Adds or edits a log under a lock on the person, so two saves at once cannot leave overlapping
 * logs. Returns the saved log.
 */
type PeriodFields = { startDate: string; endDate: string | null; flow: string | null; symptoms: string[] };

/**
 * `next` is the new log, or for an edit a function from the row as it stands under the lock (so a
 * partial edit never writes back another edit's stale fields).
 */
async function savePeriod(db: PrismaClient, userId: string, patientId: string, nextOf: PeriodFields | ((cur: PeriodView) => PeriodFields), now: Date, editingId?: string) {
    if (typeof nextOf !== 'function') checkPeriodDates(nextOf.startDate, nextOf.endDate, now);
    const today = istDay(now);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patientId} FOR UPDATE`;
        let next: PeriodFields;
        if (typeof nextOf === 'function') {
            const fresh = await tx.periodLog.findFirst({ where: { id: editingId, userId }, select: periodSelect });
            if (!fresh) throw new DoctorError(404, 'Not found');
            next = nextOf(periodView(fresh));
            checkPeriodDates(next.startDate, next.endDate, now);
        } else {
            next = nextOf;
        }
        const others = (await tx.periodLog.findMany({ where: { patientId, ...(editingId ? { id: { not: editingId } } : {}) }, select: periodSelect })).map(periodView);
        const clash = others.find((o) => overlaps(o, next, today));
        if (clash) throw new DoctorError(409, `This overlaps the period logged from ${clash.startDate}. Edit that one instead.`);
        const data = { startDate: dayDate(next.startDate), endDate: next.endDate ? dayDate(next.endDate) : null, flow: next.flow, symptoms: [...new Set(next.symptoms)] };
        const row = editingId
            ? await tx.periodLog.update({ where: { id: editingId }, data, select: periodSelect })
            : await tx.periodLog.create({ data: { userId, patientId, ...data }, select: periodSelect });
        return periodView(row);
    });
}

export async function addPeriod(userId: string, patientId: string, input: PeriodInput, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    await ownPerson(db, userId, patientId);
    return savePeriod(db, userId, patientId, { startDate: input.startDate, endDate: input.endDate ?? null, flow: input.flow ?? null, symptoms: input.symptoms ?? [] }, now);
}

/** Changes only the fields sent: typically the end date of a period that was still going. */
export async function editPeriod(userId: string, id: string, input: PeriodEdit, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    // Only the person is read here (for the lock); the fields are merged onto the row read under it.
    const row = await db.periodLog.findFirst({ where: { id, userId }, select: { patientId: true } });
    if (!row) throw new DoctorError(404, 'Not found');
    return savePeriod(db, userId, row.patientId, (cur) => ({
        startDate: input.startDate ?? cur.startDate,
        endDate: input.endDate !== undefined ? input.endDate : cur.endDate,
        flow: input.flow !== undefined ? input.flow : cur.flow,
        symptoms: input.symptoms ?? cur.symptoms,
    }), now, id);
}

export async function removePeriod(userId: string, id: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const res = await db.periodLog.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new DoctorError(404, 'Not found');
    return { id, removed: true };
}

// ── Doctor (shared record) and super admin ──────────────

/** What a doctor sees in the shared record: the last 180 days of readings, recent periods. */
export const RECORD_VITALS_DAYS = 180;
export const RECORD_READINGS = 60;
export const RECORD_PERIODS = 12;

/**
 * One person's vitals for a record view. Callers check access and write the log row; this only reads.
 */
export async function vitalsForRecord(db: Pick<PrismaClient, 'vitalReading' | 'periodLog'>, patientId: string, now: Date, opts: { days?: number; readings?: number; periods?: number } = {}) {
    const since = new Date(now.getTime() - (opts.days ?? RECORD_VITALS_DAYS) * DAY_MS);
    const take = opts.readings ?? RECORD_READINGS;
    const where = (kind: VitalKind) => ({ patientId, kind, measuredAt: { gte: since } });
    const readings = (kind: VitalKind) => db.vitalReading.findMany({ where: where(kind), orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }], take, select: readingSelect });
    const [bp, sugar, bpTotal, sugarTotal, periods, periodTotal] = await Promise.all([
        readings('BP'), readings('SUGAR'), db.vitalReading.count({ where: where('BP') }), db.vitalReading.count({ where: where('SUGAR') }),
        periodsOf(db, patientId, now, opts.periods ?? RECORD_PERIODS), db.periodLog.count({ where: { patientId } }),
    ]);
    // The lists stop at the latest `take`; the screens say "latest N of M" when there are more.
    return { since: istDay(since), bp, sugar, periods: periods.logs, periodEstimate: periods.estimate, totals: { bp: bpTotal, sugar: sugarTotal, periods: periodTotal } };
}
