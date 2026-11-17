import { describe, expect, it } from 'vitest';
import { searchDoctors } from './doctorSearch';
import type { DoctorSummary } from './types';

const doc = (id: string, displayName: string, specialty: string, qualification = 'MBBS'): DoctorSummary =>
    ({
        id, displayName, photoUrl: null, qualification, experienceYears: 8, languages: ['English'], bio: null,
        consultationFee: 500, slotMinutes: 15, specialty: { id: `s-${specialty}`, name: specialty, slug: specialty.toLowerCase().replace(/\s+/g, '-') },
    }) as DoctorSummary;

const DOCTORS = [doc('1', 'Dr. Anjali Mehta', 'General Physician'), doc('2', 'Dr. Rohan Kapoor', 'Dermatology', 'MBBS, MD (Dermatology)'), doc('3', 'Dr. Sana Iqbal', 'Paediatrics')];

describe('searchDoctors', () => {
    it('matches name (with or without Dr), specialty and qualification', () => {
        expect(searchDoctors(DOCTORS, 'Dr Kapoor').map((d) => d.id)).toEqual(['2']);
        expect(searchDoctors(DOCTORS, 'paediatrics').map((d) => d.id)).toEqual(['3']);
        expect(searchDoctors(DOCTORS, 'MD').map((d) => d.id)).toEqual(['2']);
    });

    it('maps symptoms to the specialties that treat them', () => {
        expect(searchDoctors(DOCTORS, 'fever').map((d) => d.id)).toEqual(['1']);
        expect(searchDoctors(DOCTORS, 'hair fall').map((d) => d.id)).toEqual(['2']);
        expect(searchDoctors(DOCTORS, 'baby').map((d) => d.id)).toEqual(['3']);
    });

    it('returns everyone for an empty query and no one for an unrelated word', () => {
        expect(searchDoctors(DOCTORS, ' ')).toHaveLength(3);
        expect(searchDoctors(DOCTORS, 'thyrocare')).toEqual([]);
    });
});
