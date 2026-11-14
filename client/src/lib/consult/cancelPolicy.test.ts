import { describe, expect, it } from 'vitest';
import { cancelPolicyLines } from './cancelPolicy';

describe('cancelPolicyLines', () => {
    it('reads the default tiers in plain words, in any input order', () => {
        expect(cancelPolicyLines([{ minHoursBefore: 0, percent: 0 }, { minHoursBefore: 24, percent: 100 }, { minHoursBefore: 6, percent: 50 }])).toEqual([
            '24 hours or more before: full refund',
            '6 to 24 hours before: 50% refund',
            'Less than 6 hours before: no refund',
        ]);
    });

    it('handles a single tier and singular hours', () => {
        expect(cancelPolicyLines([{ minHoursBefore: 0, percent: 100 }])).toEqual(['Any time before: full refund']);
        expect(cancelPolicyLines([{ minHoursBefore: 1, percent: 100 }, { minHoursBefore: 0, percent: 0 }])).toEqual([
            '1 hour or more before: full refund',
            'Less than 1 hour before: no refund',
        ]);
    });
});
