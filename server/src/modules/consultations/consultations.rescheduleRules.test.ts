import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, rulesOf, validateRules } from './consultations.policy';
import { cutoffText, selfRescheduleState } from './consultations.rescheduleRules';

const START = new Date('2026-12-01T10:00:00Z');
const at = (minutesBefore: number) => new Date(START.getTime() - minutesBefore * 60_000);
const booking = (over: Record<string, unknown> = {}) => ({ status: 'CONFIRMED', startsAt: START, rescheduleCount: 0, policySnapshot: DEFAULT_RULES, reviewReason: null, ...over });

describe('reschedule rules', () => {
    it('defaults: 2 hours before, at most 2 times', () => {
        expect(DEFAULT_RULES).toMatchObject({ rescheduleCutoffMinutes: 120, maxReschedules: 2 });
        expect(validateRules(DEFAULT_RULES)).toBeNull();
    });
    it('keeps the values inside the ceilings', () => {
        expect(validateRules({ ...DEFAULT_RULES, rescheduleCutoffMinutes: 10 })).toMatch(/Reschedule cutoff must be 30 to 2880/);
        expect(validateRules({ ...DEFAULT_RULES, rescheduleCutoffMinutes: 90.5 })).toMatch(/Reschedule cutoff/);
        expect(validateRules({ ...DEFAULT_RULES, maxReschedules: 6 })).toMatch(/Reschedules per booking must be 0 to 5/);
        expect(validateRules({ ...DEFAULT_RULES, maxReschedules: 0 })).toBeNull();
    });
    it('fills rules a booking copied before they existed', () => {
        const { rescheduleCutoffMinutes: _a, maxReschedules: _b, ...older } = DEFAULT_RULES;
        expect(rulesOf(older)).toEqual(DEFAULT_RULES);
        expect(rulesOf({ ...older, maxReschedules: 1 }).maxReschedules).toBe(1);
        expect(rulesOf(null)).toEqual(DEFAULT_RULES);
    });
});

describe('selfRescheduleState', () => {
    it('is open until the cutoff, then closed with a reason', () => {
        expect(selfRescheduleState(booking(), at(121))).toMatchObject({ allowed: true, reason: null, used: 0, max: 2, cutoffMinutes: 120, deadline: at(120) });
        expect(selfRescheduleState(booking(), at(120))).toMatchObject({ allowed: false, reason: 'The time can be changed only until 2 hours before the start.' });
    });
    it('counts changes against the limit', () => {
        expect(selfRescheduleState(booking({ rescheduleCount: 1 }), at(600)).allowed).toBe(true);
        expect(selfRescheduleState(booking({ rescheduleCount: 2 }), at(600)).reason).toBe('You have already changed the time 2 times, the most allowed.');
        expect(selfRescheduleState(booking({ rescheduleCount: 1, policySnapshot: { ...DEFAULT_RULES, maxReschedules: 1 } }), at(600)).reason).toMatch(/once/);
    });
    it('is closed for anything but a confirmed booking, under staff check, or when turned off', () => {
        for (const status of ['WAITING', 'IN_PROGRESS', 'CANCELLED', 'PENDING_PAYMENT', 'COMPLETED']) {
            expect(selfRescheduleState(booking({ status }), at(600)).allowed).toBe(false);
        }
        expect(selfRescheduleState(booking({ reviewReason: 'refund check' }), at(600)).allowed).toBe(false);
        expect(selfRescheduleState(booking({ policySnapshot: { ...DEFAULT_RULES, maxReschedules: 0 } }), at(600)).reason).toBe('Changing the time is not available for this booking.');
    });
    it('writes the cutoff in words', () => {
        expect(cutoffText(120)).toBe('2 hours');
        expect(cutoffText(60)).toBe('1 hour');
        expect(cutoffText(90)).toBe('90 minutes');
    });
});
