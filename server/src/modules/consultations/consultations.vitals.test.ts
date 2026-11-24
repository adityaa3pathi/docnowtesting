/** P8 vitals: the value checks and the next-period estimate (pure). */
import { describe, expect, it } from 'vitest';
import { checkMeasuredAt, checkPeriodDates, estimateNextPeriod, istDay, periodEditSchema, periodSchema, readingSchema } from './consultations.vitals';

const NOW = new Date('2026-11-24T06:30:00Z'); // 12:00 IST
const err = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? null : r.error!.issues[0].message);

describe('reading values', () => {
    const bp = (o: Record<string, unknown>) => readingSchema.safeParse({ kind: 'BP', systolic: 120, diastolic: 80, measuredAt: NOW.toISOString(), ...o });
    const sugar = (o: Record<string, unknown>) => readingSchema.safeParse({ kind: 'SUGAR', glucoseMgDl: 110, sugarTiming: 'FASTING', measuredAt: NOW.toISOString(), ...o });

    it('accepts possible values, including ones far from normal', () => {
        expect(bp({}).success).toBe(true);
        expect(bp({ systolic: 250, diastolic: 150, pulse: 180 }).success).toBe(true);
        expect(bp({ systolic: 60, diastolic: 35, pulse: null }).success).toBe(true);
        expect(sugar({ glucoseMgDl: 45 }).success).toBe(true);
        expect(sugar({ glucoseMgDl: 900, sugarTiming: 'RANDOM' }).success).toBe(true);
    });

    it('rejects impossible values with a plain message', () => {
        expect(err(bp({ systolic: 400 }))).toMatch(/between 50 and 300 mmHg/);
        expect(err(bp({ diastolic: 10 }))).toMatch(/between 30 and 200 mmHg/);
        expect(err(bp({ systolic: 80, diastolic: 90 }))).toBe('The upper number must be higher than the lower one');
        expect(err(bp({ systolic: 120, diastolic: 120 }))).toBe('The upper number must be higher than the lower one');
        expect(err(bp({ pulse: 400 }))).toMatch(/pulse/);
        expect(err(bp({ systolic: 120.5 }))).toMatch(/whole number/);
        expect(err(bp({ systolic: '120' }))).toBeTruthy();
        expect(err(sugar({ glucoseMgDl: 5 }))).toMatch(/between 20 and 1000 mg\/dL/);
        expect(err(sugar({ glucoseMgDl: 1500 }))).toMatch(/between 20 and 1000/);
        expect(err(sugar({ sugarTiming: 'LUNCH' }))).toMatch(/fasting, before a meal/);
        expect(err(readingSchema.safeParse({ kind: 'WEIGHT', measuredAt: NOW.toISOString() }))).toBeTruthy();
        expect(err(bp({ measuredAt: 'not a date' }))).toBeTruthy();
        expect(err(bp({ note: 'x'.repeat(201) }))).toMatch(/200 characters/);
    });

    it('a BP reading cannot carry a sugar value, nor the other way round', () => {
        const parsed = bp({ glucoseMgDl: 100 });
        expect(parsed.success && 'glucoseMgDl' in parsed.data).toBe(false);
    });

    it('the time of a reading: not in the future (5 minutes of clock skew), at most 5 years back', () => {
        expect(() => checkMeasuredAt(new Date(NOW.getTime() + 4 * 60_000), NOW)).not.toThrow();
        expect(() => checkMeasuredAt(new Date(NOW.getTime() + 10 * 60_000), NOW)).toThrow('cannot be in the future');
        expect(() => checkMeasuredAt(new Date('2021-12-01T00:00:00Z'), NOW)).not.toThrow();
        expect(() => checkMeasuredAt(new Date('2021-11-01T00:00:00Z'), NOW)).toThrow('5 years');
    });
});

describe('period dates', () => {
    it('only real calendar dates', () => {
        expect(periodSchema.safeParse({ startDate: '2026-11-01' }).success).toBe(true);
        expect(err(periodSchema.safeParse({ startDate: '2026-02-30' }))).toBe('Enter a real date');
        expect(err(periodSchema.safeParse({ startDate: '1/11/2026' }))).toMatch(/YYYY-MM-DD/);
        expect(err(periodSchema.safeParse({ startDate: '2026-11-01', flow: 'SPOTTING' }))).toMatch(/light, medium or heavy/);
        expect(err(periodSchema.safeParse({ startDate: '2026-11-01', symptoms: ['CRAMPS', 'X'] }))).toBe('Unknown symptom');
    });

    it('an edit carries only what was sent (no defaults filled in)', () => {
        const r = periodEditSchema.parse({ endDate: '2026-11-05' });
        expect(r).toEqual({ endDate: '2026-11-05' });
    });

    it('today is the IST day: 00:30 IST on the 25th is already the 25th', () => {
        expect(istDay(new Date('2026-11-24T19:00:00Z'))).toBe('2026-11-25');
        expect(istDay(NOW)).toBe('2026-11-24');
        expect(() => checkPeriodDates('2026-11-25', null, new Date('2026-11-24T19:00:00Z'))).not.toThrow();
        expect(() => checkPeriodDates('2026-11-25', null, NOW)).toThrow('cannot start in the future');
    });

    it('end on or after the start, not in the future, at most 15 days in all; at most 3 years back', () => {
        expect(() => checkPeriodDates('2026-11-10', '2026-11-10', NOW)).not.toThrow();
        expect(() => checkPeriodDates('2026-11-01', '2026-11-15', NOW)).not.toThrow();
        expect(() => checkPeriodDates('2026-11-01', '2026-11-16', NOW)).toThrow('at most 15 days');
        expect(() => checkPeriodDates('2026-11-10', '2026-11-09', NOW)).toThrow('before the start');
        expect(() => checkPeriodDates('2026-11-20', '2026-11-25', NOW)).toThrow('end date cannot be in the future');
        expect(() => checkPeriodDates('2023-11-01', null, NOW)).toThrow('3 years');
    });
});

describe('next-period estimate', () => {
    it('needs two cycles (three starts)', () => {
        expect(estimateNextPeriod([], '2026-11-24')).toBeNull();
        expect(estimateNextPeriod(['2026-10-01'], '2026-11-24')).toBeNull();
        expect(estimateNextPeriod(['2026-10-01', '2026-10-29'], '2026-11-24')).toBeNull();
    });

    it('averages the cycles and adds it to the last start, in any input order', () => {
        const e = estimateNextPeriod(['2026-10-27', '2026-09-01', '2026-09-29'], '2026-11-01');
        // 28 and 28 days
        expect(e).toEqual({ nextStart: '2026-11-24', averageCycleDays: 28, cyclesUsed: 2, passed: false });
        const odd = estimateNextPeriod(['2026-08-01', '2026-08-27', '2026-09-28'], '2026-10-01');
        // 26 and 32 → 29
        expect(odd).toMatchObject({ nextStart: '2026-10-27', averageCycleDays: 29 });
    });

    it('uses only the latest 6 cycles', () => {
        // Six old 40-day cycles, then six 25-day ones.
        const starts: string[] = [];
        let t = Date.parse('2025-01-01T00:00:00Z');
        for (let i = 0; i < 7; i++) { starts.push(new Date(t).toISOString().slice(0, 10)); t += 40 * 86_400_000; }
        for (let i = 0; i < 6; i++) { t += 25 * 86_400_000 - 40 * 86_400_000 * (i === 0 ? 1 : 0); starts.push(new Date(t).toISOString().slice(0, 10)); }
        const e = estimateNextPeriod(starts, '2026-11-24')!;
        expect(e.cyclesUsed).toBe(6);
        expect(e.averageCycleDays).toBe(25);
    });

    it('skips gaps that look like a missed log (over 60 days) or a double log (under 15)', () => {
        const e = estimateNextPeriod(['2026-03-01', '2026-03-29', '2026-07-01', '2026-07-05', '2026-07-29'], '2026-08-01')!;
        // gaps: 28 (kept), 94 (skip), 4 (skip), 24 (kept)
        expect(e).toMatchObject({ averageCycleDays: 26, cyclesUsed: 2, nextStart: '2026-08-24' });
        expect(estimateNextPeriod(['2026-01-01', '2026-05-01', '2026-09-01'], '2026-11-24')).toBeNull();
    });

    it('says when the estimated day has passed', () => {
        expect(estimateNextPeriod(['2026-09-01', '2026-09-29', '2026-10-27'], '2026-11-25')!.passed).toBe(true);
        expect(estimateNextPeriod(['2026-09-01', '2026-09-29', '2026-10-27'], '2026-11-24')!.passed).toBe(false);
    });
});
