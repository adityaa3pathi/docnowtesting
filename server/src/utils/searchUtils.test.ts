import { describe, expect, it } from 'vitest';
import {
    buildCatalogSearchWhere,
    fuzzyScore,
    multiFieldFuzzyScore,
    normalizePurposeForSearch,
    normalizeSearchTerm,
    rankSearchResults,
} from './searchUtils';

describe('searchUtils', () => {
    it('normalizes catalog names for formatting-insensitive search', () => {
        expect(normalizeSearchTerm('  Vitamin-D 25 OH! ')).toBe('vitamind25oh');
        expect(normalizeSearchTerm('CBC Test')).toBe('cbctest');
        expect(normalizePurposeForSearch('Checks your blood sugar levels for diabetes management.')).toBe(
            'checksyourbloodsugarlevelsfordiabetesmanagement'
        );
    });

    it('builds single-token search with searchName and searchPurpose', () => {
        expect(buildCatalogSearchWhere('Vitamin')).toEqual({
            OR: [
                { searchName: { contains: 'vitamin' } },
                { searchPurpose: { contains: 'vitamin' } },
                { name: { contains: 'Vitamin', mode: 'insensitive' } },
                { purpose: { contains: 'Vitamin', mode: 'insensitive' } },
            ],
        });
    });

    it('builds multi-token search with AND conditions per token for name and purpose', () => {
        const result = buildCatalogSearchWhere('culture swab');
        expect(result.OR).toEqual([
            {
                AND: [
                    { searchName: { contains: 'culture' } },
                    { searchName: { contains: 'swab' } },
                ],
            },
            {
                AND: [
                    { searchPurpose: { contains: 'culture' } },
                    { searchPurpose: { contains: 'swab' } },
                ],
            },
            { name: { contains: 'culture swab', mode: 'insensitive' } },
            { purpose: { contains: 'culture swab', mode: 'insensitive' } },
        ]);
    });

    it('scores exact and prefix matches above broad contains matches', () => {
        expect(fuzzyScore('cbc', 'CBC')).toBeGreaterThan(fuzzyScore('bc', 'CBC Test'));
        expect(fuzzyScore('thyroid', 'Thyroid Profile Total')).toBeGreaterThan(0);
    });

    it('scores purpose matches and respects field weights in multiFieldFuzzyScore', () => {
        // Direct title match vs Purpose-only match
        const directTitle = { name: 'Diabetes Screening Panel', purpose: null };
        const purposeMatch = {
            name: 'HbA1c Glycated Hemoglobin Test',
            purpose: 'Monitors 3-month average blood sugar levels for diabetes diagnosis and management',
        };
        const unrelated = { name: 'Lipid Profile', purpose: 'Measures cholesterol and heart health' };

        const titleScore = multiFieldFuzzyScore('diabetes', directTitle);
        const purposeScore = multiFieldFuzzyScore('diabetes', purposeMatch);
        const unrelatedScore = multiFieldFuzzyScore('diabetes', unrelated);

        // Direct name match (starts with 'Diabetes') must rank above purpose match
        expect(titleScore).toBeGreaterThan(purposeScore);
        // Purpose match must rank substantially above unrelated item
        expect(purposeScore).toBeGreaterThan(unrelatedScore);
        expect(unrelatedScore).toBe(0);
        // Purpose score should be positive (~42)
        expect(purposeScore).toBeGreaterThan(30);
    });

    it('rewards multi-field matches with a boost when query appears in both title and purpose', () => {
        const titleOnly = { name: 'Thyroid Profile', purpose: 'General health check' };
        const bothMatch = { name: 'Thyroid Profile', purpose: 'Comprehensive test for thyroid hormone disorders' };

        const titleScore = multiFieldFuzzyScore('thyroid', titleOnly);
        const bothScore = multiFieldFuzzyScore('thyroid', bothMatch);

        expect(bothScore).toBeGreaterThan(titleScore);
    });

    it('ranks search results by relevance without mutating the input list', () => {
        const items = [
            { name: 'Vitamin B12', id: 'b12', purpose: null },
            { name: 'CBC Test', id: 'cbc', purpose: 'Complete hemogram evaluation' },
            { name: 'Complete Blood Count', id: 'full-cbc', purpose: 'Routine blood check' },
            { name: 'Hemoglobin Panel', id: 'hemo', purpose: 'Includes CBC for anemia evaluation' },
        ];

        const ranked = rankSearchResults(items, 'cbc');

        // Exact abbreviation match 'CBC Test' should be first
        expect(ranked[0].id).toBe('cbc');
        // 'Hemoglobin Panel' which matches 'CBC' only in purpose should be included after direct title matches
        const rankedIds = ranked.map(r => r.id);
        expect(rankedIds).toContain('hemo');
        // The original items array is untouched
        expect(items[0].id).toBe('b12');
    });

    it('surfaces tests when search query only matches the purpose description', () => {
        const catalog = [
            { id: '1', name: 'Thyroid Profile', purpose: 'Checks thyroid glands' },
            { id: '2', name: 'HbA1c', purpose: 'Long term blood sugar and diabetes indicator' },
            { id: '3', name: 'Lipid Profile', purpose: 'Cholesterol and cardiovascular risk' },
        ];

        const results = rankSearchResults(catalog, 'diabetes');
        expect(results[0].id).toBe('2');
        expect(results[0].name).toBe('HbA1c');
    });
});
