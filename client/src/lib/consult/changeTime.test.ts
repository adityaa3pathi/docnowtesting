import { describe, expect, it } from 'vitest';
import { changeTimeRules, cutoffText, movableSlots } from './changeTime';

describe('change time', () => {
    it('writes the rules plainly', () => {
        const r = { allowed: true, reason: null, used: 1, max: 2, cutoffMinutes: 120, deadline: '' };
        expect(changeTimeRules(r)).toBe('Free, with the same doctor, until 2 hours before the start. 1 of 2 changes left.');
        expect(changeTimeRules({ ...r, used: 0, max: 1, cutoffMinutes: 90 })).toBe('Free, with the same doctor, until 90 minutes before the start. 1 of 1 change left.');
        expect(cutoffText(60)).toBe('1 hour');
    });
    it('offers only other times far enough ahead', () => {
        const now = Date.parse('2026-12-01T00:00:00Z');
        const slot = (id: string, iso: string) => ({ id, startsAt: iso, endsAt: iso });
        const slots = [slot('current', '2026-12-02T05:00:00Z'), slot('soon', '2026-12-01T00:10:00Z'), slot('ok', '2026-12-03T05:00:00Z')];
        expect(movableSlots(slots, '2026-12-02T05:00:00.000Z', now).map((s) => s.id)).toEqual(['ok']);
    });
});
