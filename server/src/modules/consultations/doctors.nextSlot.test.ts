import { describe, expect, it } from 'vitest';
import { withNextSlot } from './doctors.nextSlot';

describe('withNextSlot', () => {
    it('adds each doctor\'s earliest bookable time, or null when none is open', () => {
        const out = withNextSlot([{ id: 'a' }, { id: 'b' }], [{ doctorId: 'a', _min: { startsAt: new Date('2026-11-08T11:00:00Z') } }]);
        expect(out).toEqual([{ id: 'a', nextSlotAt: '2026-11-08T11:00:00.000Z' }, { id: 'b', nextSlotAt: null }]);
    });
});
