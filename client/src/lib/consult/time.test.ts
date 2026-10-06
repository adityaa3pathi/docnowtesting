import { beforeEach, describe, expect, it } from 'vitest';
import { formatIstDateTime, formatIstTime, groupSlotsByDay, istDayKey, minutesToTime, recordServerDate, resetServerClockForTests, secondsUntil, serverNow, timeToMinutes } from './time';

describe('Indian time', () => {
    it('shows a late-evening UTC instant as the next morning in India', () => {
        expect(istDayKey('2026-10-06T22:00:00Z')).toBe('2026-10-07');
        expect(formatIstTime('2026-10-06T22:00:00Z')).toBe('3:30 AM');
        expect(formatIstDateTime('2026-10-06T22:00:00Z')).toMatch(/7 Oct/);
    });
    it('groups slots by Indian day in time order and skips empty days', () => {
        const days = groupSlotsByDay([
            { id: 'c', startsAt: '2026-10-07T04:30:00Z' },
            { id: 'a', startsAt: '2026-10-06T22:00:00Z' },
            { id: 'b', startsAt: '2026-10-07T03:30:00Z' },
        ]);
        expect(days.map((d) => d.key)).toEqual(['2026-10-07']);
        expect(days[0].slots.map((s) => s.id)).toEqual(['a', 'b', 'c']);
        expect(groupSlotsByDay([])).toEqual([]);
    });
    it('splits slots either side of Indian midnight', () => {
        const days = groupSlotsByDay([
            { startsAt: '2026-10-06T18:00:00Z' },
            { startsAt: '2026-10-06T18:45:00Z' },
        ]);
        expect(days.map((d) => d.key)).toEqual(['2026-10-06', '2026-10-07']);
    });
});

describe('hours text', () => {
    it('saves 10:00 to 14:00 as 600 to 840 minutes and reads it back the same', () => {
        expect(timeToMinutes('10:00')).toBe(600);
        expect(timeToMinutes('14:00')).toBe(840);
        expect(minutesToTime(600)).toBe('10:00');
        expect(minutesToTime(840)).toBe('14:00');
        expect(minutesToTime(timeToMinutes('09:05')!)).toBe('09:05');
    });
    it('rejects text that is not a time', () => {
        expect(timeToMinutes('')).toBeNull();
        expect(timeToMinutes('25:00')).toBeNull();
        expect(timeToMinutes('10:75')).toBeNull();
        expect(timeToMinutes('ten')).toBeNull();
    });
});

describe('server clock', () => {
    beforeEach(() => resetServerClockForTests());

    it('corrects a device clock that runs 5 minutes fast', () => {
        const server = Date.parse('2026-10-07T10:00:00Z');
        const deviceNow = server + 5 * 60_000;
        recordServerDate(new Date(server).toUTCString(), deviceNow);
        // A hold ending 10 minutes after server time has 10 minutes left, not 5.
        expect(secondsUntil('2026-10-07T10:10:00Z', deviceNow)).toBe(600);
    });
    it('falls back to the device clock without a header and never goes below zero', () => {
        recordServerDate(undefined);
        recordServerDate('not a date');
        expect(serverNow(1000)).toBe(1000);
        expect(secondsUntil('2026-10-07T10:00:00Z', Date.parse('2026-10-07T11:00:00Z'))).toBe(0);
    });
});
