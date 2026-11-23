import { describe, expect, it } from 'vitest';
import { promoScopePayload, promoScopeSummary } from './promoScope';

describe('promoScopePayload', () => {
    it('drops doctor and specialty limits from a lab-only code', () => {
        expect(promoScopePayload('LAB', ['d1'], ['s1'])).toEqual({ appliesTo: 'LAB', doctorIds: [], specialtyIds: [] });
    });
    it('keeps limits, without repeats, for consultation codes', () => {
        expect(promoScopePayload('CONSULT', ['d1', 'd1'], ['s1'])).toEqual({ appliesTo: 'CONSULT', doctorIds: ['d1'], specialtyIds: ['s1'] });
        expect(promoScopePayload('BOTH', [], [])).toEqual({ appliesTo: 'BOTH', doctorIds: [], specialtyIds: [] });
    });
});

describe('promoScopeSummary', () => {
    it('says where the code works, and old codes are lab', () => {
        expect(promoScopeSummary({})).toBe('Lab tests');
        expect(promoScopeSummary({ appliesTo: 'CONSULT', scopes: [] })).toBe('Doctor consultations');
    });
    it('names the limits, shortening long lists', () => {
        const scopes = [{ doctor: { displayName: 'Meera Rao' } }, { specialty: { name: 'Dermatology' } }, { specialty: { name: 'ENT' } }];
        expect(promoScopeSummary({ appliesTo: 'CONSULT', scopes })).toBe('Doctor consultations · only Meera Rao, Dermatology +1 more');
    });
});
