import { describe, expect, it } from 'vitest';
import { bpBody, calendarMarks, istInputToIso, istNowInput, istToday, monthGrid, periodDays, periodError, readingDetail, readingValue, shiftMonth, sugarBody, tracksPeriods } from './vitals';

const NOW = new Date('2026-11-24T06:30:00Z'); // 12:00 IST
const base = { measuredAt: '2026-11-24T08:00', note: '' };

describe('reading forms (same limits as the server)', () => {
    it('builds the BP body with the IST time as an instant', () => {
        expect(bpBody({ ...base, systolic: '128', diastolic: '84', pulse: '' }, NOW).body).toEqual({
            kind: 'BP', systolic: 128, diastolic: 84, pulse: null, measuredAt: '2026-11-24T02:30:00.000Z', note: undefined,
        });
        expect(bpBody({ ...base, systolic: '128', diastolic: '84', pulse: '70', note: ' after a walk ' }, NOW).body).toMatchObject({ pulse: 70, note: 'after a walk' });
    });

    it('refuses impossible BP values in plain words', () => {
        const e = (o: Partial<{ systolic: string; diastolic: string; pulse: string; measuredAt: string }>) => bpBody({ ...base, systolic: '120', diastolic: '80', pulse: '', ...o }, NOW).error;
        expect(e({ systolic: '' })).toBe('Enter the upper (systolic) number as a whole number');
        expect(e({ systolic: '12.5' })).toMatch(/whole number/);
        expect(e({ systolic: '400' })).toBe('The upper (systolic) number must be between 50 and 300 mmHg');
        expect(e({ diastolic: '20' })).toMatch(/between 30 and 200/);
        expect(e({ systolic: '80', diastolic: '80' })).toBe('The upper number must be higher than the lower one');
        expect(e({ pulse: '500' })).toMatch(/pulse must be between 25 and 250/);
        expect(e({ measuredAt: '2026-11-24T13:00' })).toBe('The time of a reading cannot be in the future');
        expect(e({ measuredAt: '' })).toBe('Enter when it was measured');
    });

    it('sugar needs a value in range and when it was measured', () => {
        expect(sugarBody({ ...base, glucoseMgDl: '104', sugarTiming: 'FASTING' }, NOW).body).toMatchObject({ kind: 'SUGAR', glucoseMgDl: 104, sugarTiming: 'FASTING' });
        expect(sugarBody({ ...base, glucoseMgDl: '1200', sugarTiming: 'FASTING' }, NOW).error).toBe('The sugar value must be between 20 and 1000 mg/dL');
        expect(sugarBody({ ...base, glucoseMgDl: '104', sugarTiming: '' }, NOW).error).toMatch(/fasting, before a meal/);
    });

    it('IST helpers', () => {
        expect(istNowInput(NOW)).toBe('2026-11-24T12:00');
        expect(istInputToIso('2026-11-25T00:30')).toBe('2026-11-24T19:00:00.000Z');
        expect(istToday(new Date('2026-11-24T19:00:00Z'))).toBe('2026-11-25');
    });
});

describe('periods', () => {
    it('date checks', () => {
        const today = '2026-11-24';
        expect(periodError('', '', today)).toBe('Enter the day the period started');
        expect(periodError('2026-11-25', '', today)).toBe('A period cannot start in the future');
        expect(periodError('2026-11-20', '2026-11-19', today)).toBe('The end date cannot be before the start date');
        expect(periodError('2026-11-20', '2026-11-25', today)).toBe('The end date cannot be in the future');
        expect(periodError('2026-11-01', '2026-11-16', today)).toBe('A period log can cover at most 15 days');
        expect(periodError('2026-11-01', '2026-11-15', today)).toBeNull();
        expect(periodError('2026-11-20', '', today)).toBeNull();
    });

    it('counts days, an ongoing period up to today (at most 15)', () => {
        expect(periodDays({ startDate: '2026-11-01', endDate: '2026-11-05' }, '2026-11-24')).toBe(5);
        expect(periodDays({ startDate: '2026-11-22', endDate: null }, '2026-11-24')).toBe(3);
        expect(periodDays({ startDate: '2026-10-01', endDate: null }, '2026-11-24')).toBe(15);
    });

    it('marks logged days and the estimated start on the calendar', () => {
        const marks = calendarMarks(
            [{ id: 'a', startDate: '2026-10-30', endDate: '2026-11-02', flow: null, symptoms: [] }],
            { nextStart: '2026-11-27', averageCycleDays: 28, cyclesUsed: 2, passed: false },
            '2026-11-24',
        );
        expect([...marks.entries()]).toEqual([
            ['2026-10-30', 'period'], ['2026-10-31', 'period'], ['2026-11-01', 'period'], ['2026-11-02', 'period'], ['2026-11-27', 'estimate'],
        ]);
    });

    it('month grid starts on Monday; months shift across years', () => {
        const nov = monthGrid('2026-11'); // 1 Nov 2026 is a Sunday
        expect(nov.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);
        expect(nov.filter(Boolean)).toHaveLength(30);
        expect(shiftMonth('2026-12', 1)).toBe('2027-01');
        expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    });

    it('the period tab shows for anyone not recorded as male', () => {
        expect(tracksPeriods('Female')).toBe(true);
        expect(tracksPeriods('Other')).toBe(true);
        expect(tracksPeriods('Male')).toBe(false);
        expect(tracksPeriods('male ')).toBe(false);
    });
});

describe('display', () => {
    it('values with units and details, no judging words', () => {
        const r = { id: '1', kind: 'BP' as const, systolic: 150, diastolic: 95, pulse: 88, glucoseMgDl: null, sugarTiming: null, measuredAt: '2026-11-24T02:30:00Z', note: 'morning' };
        expect(readingValue(r)).toBe('150/95 mmHg');
        expect(readingDetail(r)).toBe('Pulse 88 · morning');
        const s = { ...r, kind: 'SUGAR' as const, systolic: null, diastolic: null, pulse: null, glucoseMgDl: 220, sugarTiming: 'AFTER_MEAL' as const, note: null };
        expect(readingValue(s)).toBe('220 mg/dL');
        expect(readingDetail(s)).toBe('After a meal');
    });
});
