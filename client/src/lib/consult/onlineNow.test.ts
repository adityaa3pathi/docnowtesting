import { describe, expect, it } from 'vitest';
import { daysInRange, formatDuration, formatHours, istDay, ONLINE_STATE } from './onlineNow';

describe('Online now helpers', () => {
    it('formats durations and hours', () => {
        expect(formatDuration(45)).toBe('45 s');
        expect(formatDuration(12 * 60 + 5)).toBe('12 min');
        expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 05 min');
        expect(formatHours(5400)).toBe('1.5');
        expect(formatHours(0)).toBe('0.0');
    });
    it('takes the IST day, which runs 5:30 ahead of UTC', () => {
        expect(istDay(new Date('2026-11-24T18:29:00Z'))).toBe('2026-11-24');
        expect(istDay(new Date('2026-11-24T18:31:00Z'))).toBe('2026-11-25');
        expect(istDay(new Date('2026-11-24T06:00:00Z'), 6)).toBe('2026-11-18');
    });
    it('counts days in an inclusive range', () => {
        expect(daysInRange('2026-11-24', '2026-11-24')).toBe(1);
        expect(daysInRange('2026-01-01', '2026-04-03')).toBe(93);
        expect(daysInRange('2026-01-01', '2026-04-04')).toBe(94);
    });
    it('labels only FREE as ringable', () => {
        expect(Object.entries(ONLINE_STATE).filter(([, v]) => v.tone === 'success').map(([k]) => k)).toEqual(['FREE']);
    });
});
