import { describe, expect, it } from 'vitest';
import { CEILINGS, validateRules, versionChanged } from './rules';
import type { ConsultRules } from './types';

const base: ConsultRules = {
    refundTiers: [
        { minHoursBefore: 24, percent: 100 },
        { minHoursBefore: 6, percent: 50 },
        { minHoursBefore: 0, percent: 0 },
    ],
    doctorNoShowWaitMinutes: 10,
    patientNoShowWaitMinutes: 10,
    doctorNoShowOutcome: 'FULL_REFUND',
    platformFeeBps: 1000,
    holdMinutes: 10,
    minLeadMinutes: 15,
    uploadLimitMb: 10,
};
const with_ = (p: Partial<ConsultRules>): ConsultRules => ({ ...base, ...p });

describe('validateRules', () => {
    it('accepts the defaults', () => expect(validateRules(base)).toEqual([]));

    it('refuses percentages that rise as time shrinks', () => {
        const r = with_({ refundTiers: [{ minHoursBefore: 24, percent: 50 }, { minHoursBefore: 0, percent: 80 }] });
        expect(validateRules(r)).toEqual(['Refund percent cannot go up as the visit gets closer.']);
    });

    it('refuses a missing 0-hour tier', () => {
        const r = with_({ refundTiers: [{ minHoursBefore: 24, percent: 100 }, { minHoursBefore: 6, percent: 50 }] });
        expect(validateRules(r)).toHaveLength(1);
        expect(validateRules(r)[0]).toMatch(/0 hours/);
    });

    it('refuses duplicate hours', () => {
        const r = with_({ refundTiers: [{ minHoursBefore: 6, percent: 50 }, { minHoursBefore: 6, percent: 50 }, { minHoursBefore: 0, percent: 0 }] });
        expect(validateRules(r).join(' ')).toMatch(/same hours/);
    });

    it('refuses decimals and out-of-range percent', () => {
        expect(validateRules(with_({ refundTiers: [{ minHoursBefore: 0, percent: 101 }] }))).toHaveLength(1);
        expect(validateRules(with_({ refundTiers: [{ minHoursBefore: 0, percent: 50.5 }] }))).toHaveLength(1);
    });

    it('refuses an empty tier list', () => expect(validateRules(with_({ refundTiers: [] }))).toHaveLength(1));

    it('enforces each ceiling and floor', () => {
        expect(validateRules(with_({ holdMinutes: CEILINGS.holdMinutes.max + 1 }))).toHaveLength(1);
        expect(validateRules(with_({ holdMinutes: 0 }))).toHaveLength(1);
        expect(validateRules(with_({ minLeadMinutes: 4 }))).toHaveLength(1);
        expect(validateRules(with_({ minLeadMinutes: 241 }))).toHaveLength(1);
        expect(validateRules(with_({ doctorNoShowWaitMinutes: 61 }))).toHaveLength(1);
        expect(validateRules(with_({ patientNoShowWaitMinutes: 0 }))).toHaveLength(1);
        expect(validateRules(with_({ uploadLimitMb: 51 }))).toHaveLength(1);
        expect(validateRules(with_({ uploadLimitMb: 0 }))).toHaveLength(1);
    });

    it('refuses a fee above 50 percent and accepts exactly 50', () => {
        expect(validateRules(with_({ platformFeeBps: 5001 }))).toHaveLength(1);
        expect(validateRules(with_({ platformFeeBps: 5000 }))).toEqual([]);
    });

    it('reports one message per problem', () => {
        const r = with_({ holdMinutes: 99, uploadLimitMb: 99, refundTiers: [{ minHoursBefore: 3, percent: 10 }] });
        expect(validateRules(r)).toHaveLength(3);
    });
});

describe('versionChanged', () => {
    it('detects a newer active version', () => {
        expect(versionChanged(3, 4)).toBe(true);
        expect(versionChanged(3, 3)).toBe(false);
    });
});
