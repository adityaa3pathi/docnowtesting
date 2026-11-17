import { describe, expect, it } from 'vitest';
import { assertNoOverlap, computeSlots, istDayStart } from './slots';

// 2026-10-05 is a Monday. 06:00 UTC = 11:30 IST.
const MON_MORNING = new Date('2026-10-05T00:00:00Z');

describe('istDayStart', () => {
    it('returns midnight IST as a UTC instant', () => {
        expect(istDayStart(new Date('2026-10-05T10:00:00Z')).toISOString()).toBe('2026-10-04T18:30:00.000Z');
    });
    it('rolls over to the next IST day after 18:30 UTC', () => {
        expect(istDayStart(new Date('2026-10-05T19:00:00Z')).toISOString()).toBe('2026-10-05T18:30:00.000Z');
    });
});

describe('computeSlots', () => {
    const windows = [{ dayOfWeek: 1, startMinute: 600, endMinute: 660 }]; // Mon 10:00-11:00 IST

    it('splits a window into slots of the given length', () => {
        const s = computeSlots({ windows, leaves: [], slotMinutes: 15, from: MON_MORNING, days: 1 });
        expect(s).toHaveLength(4);
        expect(s[0].startsAt.toISOString()).toBe('2026-10-05T04:30:00.000Z'); // 10:00 IST
    });

    it('drops a trailing slot that does not fit', () => {
        const s = computeSlots({ windows, leaves: [], slotMinutes: 45, from: MON_MORNING, days: 1 });
        expect(s).toHaveLength(1);
    });

    it('skips slots in the past', () => {
        const from = new Date('2026-10-05T04:40:00Z'); // 10:10 IST
        const s = computeSlots({ windows, leaves: [], slotMinutes: 15, from, days: 1 });
        expect(s[0].startsAt.toISOString()).toBe('2026-10-05T04:45:00.000Z');
    });

    it('skips slots that overlap leave', () => {
        const leaves = [{ startsAt: new Date('2026-10-05T04:50:00Z'), endsAt: new Date('2026-10-05T05:10:00Z') }];
        const s = computeSlots({ windows, leaves, slotMinutes: 15, from: MON_MORNING, days: 1 });
        expect(s.map((x) => x.startsAt.toISOString())).toEqual([
            '2026-10-05T04:30:00.000Z',
            '2026-10-05T05:15:00.000Z',
        ]);
    });

    it('supports a split day with a break', () => {
        const split = [
            { dayOfWeek: 1, startMinute: 600, endMinute: 630 },
            { dayOfWeek: 1, startMinute: 900, endMinute: 930 },
        ];
        const s = computeSlots({ windows: split, leaves: [], slotMinutes: 30, from: MON_MORNING, days: 1 });
        expect(s).toHaveLength(2);
    });

    it('only uses windows for the matching weekday', () => {
        const s = computeSlots({ windows, leaves: [], slotMinutes: 15, from: MON_MORNING, days: 7 });
        expect(s).toHaveLength(4);
    });
});

describe('assertNoOverlap', () => {
    it('accepts back-to-back windows', () => {
        expect(() => assertNoOverlap([
            { dayOfWeek: 1, startMinute: 600, endMinute: 660 },
            { dayOfWeek: 1, startMinute: 660, endMinute: 720 },
        ])).not.toThrow();
    });
    it('rejects overlapping windows on one day', () => {
        expect(() => assertNoOverlap([
            { dayOfWeek: 1, startMinute: 600, endMinute: 700 },
            { dayOfWeek: 1, startMinute: 660, endMinute: 720 },
        ])).toThrow('overlap');
    });
    it('allows the same hours on different days', () => {
        expect(() => assertNoOverlap([
            { dayOfWeek: 1, startMinute: 600, endMinute: 700 },
            { dayOfWeek: 2, startMinute: 600, endMinute: 700 },
        ])).not.toThrow();
    });
});
