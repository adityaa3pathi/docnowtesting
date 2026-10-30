import { describe, expect, it } from 'vitest';
import type { Specialty } from '@/lib/consult/types';
import { HOME_SPECIALTIES, resolveSpecialty, specialtyHref, specialtyLabel } from './specialties';

const sp = (id: string, name: string, slug: string): Specialty => ({ id, name, slug, isActive: true });
const LIST = [sp('s1', 'General Medicine', 'general-medicine'), sp('s2', 'Dermatology', 'dermatology'), sp('s3', 'Paediatrics', 'paediatrics')];

describe('homepage specialties', () => {
    it('lists the eight lead specialties, each with symptoms and a /consult link', () => {
        expect(HOME_SPECIALTIES).toHaveLength(8);
        for (const s of HOME_SPECIALTIES) expect(s.symptoms.length).toBeGreaterThan(1);
        expect(specialtyHref('dermatologist')).toBe('/consult?specialty=dermatologist');
    });

    it('maps a homepage key or a real slug to this deployment’s specialty', () => {
        expect(resolveSpecialty('dermatology', LIST)?.id).toBe('s2');
        expect(resolveSpecialty('dermatologist', LIST)?.id).toBe('s2');
        expect(resolveSpecialty('general-physician', LIST)?.id).toBe('s1');
        expect(resolveSpecialty('pediatrician', LIST)?.id).toBe('s3');
    });

    it('returns null when nothing like it is offered', () => {
        expect(resolveSpecialty('cardiologist', LIST)).toBeNull();
        expect(resolveSpecialty('made-up', LIST)).toBeNull();
        expect(resolveSpecialty(null, LIST)).toBeNull();
        expect(specialtyLabel('cardiologist')).toBe('Cardiologist');
    });
});
