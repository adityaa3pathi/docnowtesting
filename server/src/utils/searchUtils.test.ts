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

    it('builds normalized and natural-language Prisma search clauses', () => {
        expect(buildCatalogSearchWhere('Vitamin D')).toEqual({
            OR: [
                { searchName: { contains: 'vitamind' } },
                { name: { contains: 'Vitamin D', mode: 'insensitive' } },
            ],
        });
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
