import { describe, expect, it } from 'vitest';
import { activeFilterCount, directoryQuery, filtersFromParams, filtersToParams, isFiltered, NO_FILTERS, withFilters } from './doctorFilters';

const from = (qs: string) => filtersFromParams(new URLSearchParams(qs));

describe('doctor filters in the URL', () => {
    it('reads every filter back from the URL it wrote, and keeps other keys like the specialty', () => {
        const f = { q: 'Anil', now: true, languages: ['Hindi', 'English'], gender: 'Female' as const, minExperience: 10, maxFee: 500, sort: 'fee_low' as const, page: 3 };
        const p = filtersToParams(f, new URLSearchParams('specialty=general-physician&page=9'));
        expect(p.get('specialty')).toBe('general-physician');
        expect(p.toString()).toBe('specialty=general-physician&q=Anil&now=1&lang=Hindi%2CEnglish&gender=Female&exp=10&fee=500&sort=fee_low&page=3');
        expect(filtersFromParams(p)).toEqual(f);
    });

    it('leaves defaults out, so an unfiltered list has a clean URL', () => {
        expect(filtersToParams(NO_FILTERS).toString()).toBe('');
        expect(filtersToParams({ ...NO_FILTERS, q: '   ' }).toString()).toBe('');
    });

    it('drops bad or unknown values instead of guessing', () => {
        expect(from('now=yes&gender=Other&exp=-3&fee=0&sort=cheap&page=0&lang=,,')).toEqual(NO_FILTERS);
        expect(from('exp=61&fee=1.5&page=abc')).toEqual(NO_FILTERS);
        expect(from(`q=${'a'.repeat(200)}`).q).toHaveLength(80);
        expect(from('lang=Hindi,Hindi,%20Tamil%20').languages).toEqual(['Hindi', 'Tamil']);
        expect(from('exp=0').minExperience).toBe(0);
        // Server limits: a language over 30 characters is dropped, not sent to fail.
        expect(from(`lang=Hindi,${'x'.repeat(31)}`).languages).toEqual(['Hindi']);
    });

    it('any change but paging goes back to page 1', () => {
        expect(withFilters({ ...NO_FILTERS, page: 4 }, { gender: 'Male' }).page).toBe(1);
        expect(withFilters({ ...NO_FILTERS, page: 4 }, { page: 2 }).page).toBe(2);
    });

    it('counts chosen filters (not search or sort), and knows when anything is narrowed', () => {
        expect(activeFilterCount({ ...NO_FILTERS, now: true, languages: ['Hindi'], maxFee: 500, sort: 'fee_low', q: 'x' })).toBe(3);
        expect(isFiltered(NO_FILTERS)).toBe(false);
        expect(isFiltered({ ...NO_FILTERS, q: 'a' })).toBe(true);
        expect(isFiltered({ ...NO_FILTERS, sort: 'experience' })).toBe(true);
    });

    it('builds the API query with paging, and only the filters that are set', () => {
        expect(directoryQuery(NO_FILTERS, null)).toEqual({ page: 1, pageSize: 12, sort: 'recommended' });
        expect(directoryQuery({ ...NO_FILTERS, q: ' Dr Anil ', now: true, languages: ['Hindi', 'Tamil'], minExperience: 0, page: 2 }, 'spec-1')).toEqual({
            page: 2, pageSize: 12, sort: 'recommended', specialtyId: 'spec-1', q: 'Dr Anil', now: 1, lang: 'Hindi,Tamil', minExperience: 0,
        });
    });
});
