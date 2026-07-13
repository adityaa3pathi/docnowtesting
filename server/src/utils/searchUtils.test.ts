import { describe, expect, it } from 'vitest';
import {
    buildCatalogSearchWhere,
    fuzzyScore,
    normalizeSearchTerm,
    rankSearchResults,
} from './searchUtils';

describe('searchUtils', () => {
    it('normalizes catalog names for formatting-insensitive search', () => {
        expect(normalizeSearchTerm('  Vitamin-D 25 OH! ')).toBe('vitamind25oh');
        expect(normalizeSearchTerm('CBC Test')).toBe('cbctest');
    });

    it('builds single-token search with normalized contains', () => {
        expect(buildCatalogSearchWhere('Vitamin')).toEqual({
            OR: [
                { searchName: { contains: 'vitamin' } },
                { name: { contains: 'Vitamin', mode: 'insensitive' } },
            ],
        });
    });

    it('builds multi-token search with AND conditions per token', () => {
        const result = buildCatalogSearchWhere('culture swab');
        expect(result.OR[0]).toEqual({
            AND: [
                { searchName: { contains: 'culture' } },
                { searchName: { contains: 'swab' } },
            ],
        });
        // Still has the natural-language fallback
        expect(result.OR[1]).toEqual({ name: { contains: 'culture swab', mode: 'insensitive' } });
    });

    it('scores exact and prefix matches above broad contains matches', () => {
        expect(fuzzyScore('cbc', 'CBC')).toBeGreaterThan(fuzzyScore('bc', 'CBC Test'));
        expect(fuzzyScore('thyroid', 'Thyroid Profile Total')).toBeGreaterThan(0);
    });

    it('ranks search results by relevance without mutating the input list', () => {
        const items = [
            { name: 'Vitamin B12', id: 'b12' },
            { name: 'CBC Test', id: 'cbc' },
            { name: 'Complete Blood Count', id: 'full-cbc' },
        ];

        const ranked = rankSearchResults(items, 'cbc');

        expect(ranked[0].id).toBe('cbc');
        expect(items[0].id).toBe('b12');
    });
});
