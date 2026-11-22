import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ prisma: {} }));
vi.mock('../adapters/healthians', () => ({ HealthiansAdapter: { getInstance: () => ({}) } }));

import { applyFastingOverrideToPartnerDetails, effectiveFasting, normalizeFastingOverride } from './catalogFasting';
import { buildDetailsSummary } from '../services/catalogDetails';

// Healthians' data for "Lipid Profile (Non Fasting)" (profile_114, prod 2026-11-22).
const HEALTHIANS = { fasting: 'Required', fastingTime: '12 hour(s)' };

describe('normalizeFastingOverride', () => {
    it.each([
        [{ fasting: 'Not Required' }, { fastingOverride: 'Not Required', fastingTimeOverride: null }],
        [{ fasting: 'Required', fastingHours: 10 }, { fastingOverride: 'Required', fastingTimeOverride: '10 hour(s)' }],
        [{ fasting: 'Required' }, { fastingOverride: 'Required', fastingTimeOverride: null }],
        [{ fasting: 'Required', fastingHours: null }, { fastingOverride: 'Required', fastingTimeOverride: null }],
        [{ fasting: null }, { fastingOverride: null, fastingTimeOverride: null }],
    ])('accepts %j', (body, value) => {
        expect(normalizeFastingOverride(body)).toEqual({ ok: true, value });
    });

    it.each([
        [null], ['Required'], [{}], [{ fasting: 'required' }], [{ fasting: 'Maybe' }],
        [{ fasting: 'Not Required', fastingHours: 8 }], [{ fasting: null, fastingHours: 8 }],
        [{ fasting: 'Required', fastingHours: 0 }], [{ fasting: 'Required', fastingHours: 25 }],
        [{ fasting: 'Required', fastingHours: 10.5 }], [{ fasting: 'Required', fastingHours: '12' }],
    ])('rejects %j', (body) => {
        expect(normalizeFastingOverride(body).ok).toBe(false);
    });
});

describe('effectiveFasting', () => {
    it('uses Healthians when there is no correction', () => {
        expect(effectiveFasting(HEALTHIANS, {})).toEqual({ ...HEALTHIANS, corrected: false });
    });

    it('a "Not Required" correction also drops Healthians\' hours', () => {
        expect(effectiveFasting(HEALTHIANS, { fastingOverride: 'Not Required', fastingTimeOverride: null }))
            .toEqual({ fasting: 'Not Required', fastingTime: null, corrected: true });
    });

    it('a "Required" correction uses its own hours, not Healthians\'', () => {
        expect(effectiveFasting(HEALTHIANS, { fastingOverride: 'Required', fastingTimeOverride: '8 hour(s)' }))
            .toEqual({ fasting: 'Required', fastingTime: '8 hour(s)', corrected: true });
    });
});

describe('applyFastingOverrideToPartnerDetails', () => {
    const raw = { status: true, data: { name: 'Lipid Profile (Non Fasting)', fasting: 'Required', fasting_time: '12 hour(s)' } };

    it('patches the snake_case fields the detail pages read, without mutating the cached copy', () => {
        const out = applyFastingOverrideToPartnerDetails(raw, { fastingOverride: 'Not Required', fastingTimeOverride: null });
        expect(out.data).toEqual({ name: 'Lipid Profile (Non Fasting)', fasting: 'Not Required', fasting_time: null });
        expect(raw.data.fasting).toBe('Required');
    });

    it('returns the response untouched without a correction or without data', () => {
        expect(applyFastingOverrideToPartnerDetails(raw, null)).toBe(raw);
        expect(applyFastingOverrideToPartnerDetails(raw, { fastingOverride: null, fastingTimeOverride: null })).toBe(raw);
        const failed = { status: false, message: 'nope' };
        expect(applyFastingOverrideToPartnerDetails(failed, { fastingOverride: 'Required', fastingTimeOverride: null })).toBe(failed);
    });
});

describe('buildDetailsSummary fastingLabel (cards and the AI tool output)', () => {
    const item = { type: 'PROFILE' as const, detailsData: { constituents: [], ...HEALTHIANS } };

    it('shows Healthians without a correction', () => {
        expect(buildDetailsSummary(item).fastingLabel).toBe('Required 12 hour(s)');
    });

    it('shows the correction when there is one', () => {
        expect(buildDetailsSummary({ ...item, fastingOverride: 'Not Required' }).fastingLabel).toBe('Not Required');
        expect(buildDetailsSummary({ ...item, fastingOverride: 'Required', fastingTimeOverride: '10 hour(s)' }).fastingLabel)
            .toBe('Required 10 hour(s)');
    });
});
