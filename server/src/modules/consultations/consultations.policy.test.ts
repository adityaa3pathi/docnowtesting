import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, hasSharpRefundDrop, pickRefundPercent, validateRules, Rules } from './consultations.policy';

const rules = (patch: Partial<Rules> = {}): Rules => ({ ...DEFAULT_RULES, ...patch });

describe('pickRefundPercent', () => {
    const tiers = [
        { minHoursBefore: 24, percent: 100 },
        { minHoursBefore: 6, percent: 50 },
        { minHoursBefore: 0, percent: 0 },
    ];
    it('picks the tier for hours before the visit', () => {
        expect(pickRefundPercent(tiers, 30)).toBe(100);
        expect(pickRefundPercent(tiers, 10)).toBe(50);
        expect(pickRefundPercent(tiers, 2)).toBe(0);
    });
    it('counts the boundary in the higher tier', () => {
        expect(pickRefundPercent(tiers, 24)).toBe(100);
        expect(pickRefundPercent(tiers, 23.99)).toBe(50);
    });
    it('uses the lowest tier when the visit has already started', () => {
        expect(pickRefundPercent(tiers, -1)).toBe(0);
    });
    it('does not depend on the order tiers are stored in', () => {
        expect(pickRefundPercent([...tiers].reverse(), 10)).toBe(50);
    });
});

describe('validateRules', () => {
    it('accepts the default rules', () => {
        expect(validateRules(DEFAULT_RULES)).toBeNull();
    });
    it('rejects a percentage above 100 or below 0', () => {
        expect(validateRules(rules({ refundTiers: [{ minHoursBefore: 0, percent: 101 }] }))).toMatch(/percent/i);
        expect(validateRules(rules({ refundTiers: [{ minHoursBefore: 0, percent: -1 }] }))).toMatch(/percent/i);
    });
    it('rejects refunds that rise as the visit gets closer', () => {
        const bad = [
            { minHoursBefore: 24, percent: 50 },
            { minHoursBefore: 0, percent: 100 },
        ];
        expect(validateRules(rules({ refundTiers: bad }))).toMatch(/increase/i);
    });
    it('rejects duplicate hours and an empty list', () => {
        expect(validateRules(rules({ refundTiers: [] }))).toMatch(/tier/i);
        const dup = [
            { minHoursBefore: 24, percent: 100 },
            { minHoursBefore: 24, percent: 50 },
            { minHoursBefore: 0, percent: 0 },
        ];
        expect(validateRules(rules({ refundTiers: dup }))).toMatch(/duplicate/i);
    });
    it('requires a tier that starts at 0 hours so every time matches', () => {
        expect(validateRules(rules({ refundTiers: [{ minHoursBefore: 24, percent: 100 }] }))).toMatch(/0 hours/i);
    });
    it('rejects values above the fixed ceilings or below the floors', () => {
        expect(validateRules(rules({ holdMinutes: 3 * 24 * 60 }))).toMatch(/hold/i);
        expect(validateRules(rules({ minLeadMinutes: 0 }))).toMatch(/lead/i);
        expect(validateRules(rules({ platformFeeBps: 10000 }))).toMatch(/fee/i);
        expect(validateRules(rules({ uploadLimitMb: 5000 }))).toMatch(/upload/i);
        expect(validateRules(rules({ patientNoShowWaitMinutes: 0 }))).toMatch(/wait/i);
        expect(validateRules(rules({ doctorNoShowWaitMinutes: 600 }))).toMatch(/wait/i);
    });
});

describe('hasSharpRefundDrop', () => {
    const lower = (percent: number): Rules => ({
        ...DEFAULT_RULES,
        refundTiers: [
            { minHoursBefore: 24, percent },
            { minHoursBefore: 6, percent: Math.min(percent, 50) },
            { minHoursBefore: 0, percent: 0 },
        ],
    });
    it('flags a drop of 30 points or more on the same tier', () => {
        expect(hasSharpRefundDrop(DEFAULT_RULES, lower(60))).toBe(true);
    });
    it('ignores small drops, increases and unchanged rules', () => {
        expect(hasSharpRefundDrop(DEFAULT_RULES, lower(90))).toBe(false);
        expect(hasSharpRefundDrop(lower(60), DEFAULT_RULES)).toBe(false);
        expect(hasSharpRefundDrop(DEFAULT_RULES, DEFAULT_RULES)).toBe(false);
    });
});
