import { describe, expect, it } from 'vitest';
import { applyDoctorFilters, activeFilterCount, languageOptions, NO_FILTERS } from './doctorFilters';
import type { DoctorSummary } from './types';

const doc = (id: string, o: Partial<DoctorSummary>): DoctorSummary => ({
    id, displayName: id, photoUrl: null, qualification: 'MBBS', experienceYears: 5, languages: ['Hindi'], bio: null,
    consultationFee: 500, slotMinutes: 15, specialty: { id: 's', name: 'GP', slug: 'gp' }, gender: null, nextSlotAt: null, ...o,
});
const list = [
    doc('A', { gender: 'Female', experienceYears: 12, consultationFee: 800, languages: ['Hindi', 'English'], nextSlotAt: '2026-11-15T05:00:00Z' }),
    doc('B', { gender: 'Male', experienceYears: 3, consultationFee: 300, languages: ['Tamil'], nextSlotAt: '2026-11-14T10:00:00Z' }),
    doc('C', { experienceYears: 20, consultationFee: 1200, languages: ['English'] }),
];
const ids = (d: DoctorSummary[]) => d.map((x) => x.id);

describe('doctor filters', () => {
    it('recommended puts the soonest free doctor first and no-slot doctors last', () => {
        expect(ids(applyDoctorFilters(list, NO_FILTERS))).toEqual(['B', 'A', 'C']);
    });

    it('combines language (any of), gender, experience and fee', () => {
        expect(ids(applyDoctorFilters(list, { ...NO_FILTERS, languages: ['English', 'Tamil'] }))).toEqual(['B', 'A', 'C']);
        expect(ids(applyDoctorFilters(list, { ...NO_FILTERS, gender: 'Female' }))).toEqual(['A']);
        expect(ids(applyDoctorFilters(list, { ...NO_FILTERS, minExperience: 10, maxFee: 1000 }))).toEqual(['A']);
    });

    it('a doctor with no gender on file never matches a gender filter', () => {
        expect(ids(applyDoctorFilters(list, { ...NO_FILTERS, gender: 'Male' }))).toEqual(['B']);
    });

    it('sorts by fee and experience', () => {
        expect(ids(applyDoctorFilters(list, { ...NO_FILTERS, sort: 'fee_low' }))).toEqual(['B', 'A', 'C']);
        expect(ids(applyDoctorFilters(list, { ...NO_FILTERS, sort: 'experience' }))).toEqual(['C', 'A', 'B']);
    });

    it('lists real languages, most common first, and counts active filters', () => {
        expect(languageOptions(list)).toEqual(['English', 'Hindi', 'Tamil']);
        expect(activeFilterCount({ ...NO_FILTERS, languages: ['Hindi'], maxFee: 500, sort: 'fee_low' })).toBe(2);
    });
});
