import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ default: {} }));
const { addTag, addTags, allergyState, formFromPerson, healthBody, TAG_MAX_COUNT } = await import('./health');

const person = { id: 'p1', name: 'Asha', relation: 'Self', age: 30, gender: 'Female' };

describe('allergyState', () => {
    it('tells listed, confirmed none and never asked apart', () => {
        expect(allergyState({ allergies: ['Penicillin'] })).toBe('listed');
        expect(allergyState({ allergies: ['Penicillin'], allergiesConfirmedAt: null })).toBe('listed');
        expect(allergyState({ allergies: [], allergiesConfirmedAt: '2026-11-24T05:00:00Z' })).toBe('none');
        expect(allergyState({ allergies: [], allergiesConfirmedAt: null })).toBe('unknown');
        expect(allergyState({})).toBe('unknown');
    });
});

describe('addTag / addTags', () => {
    it('trims, squeezes spaces and drops repeats in any case', () => {
        expect(addTag([], '  Sulfa   drugs ').list).toEqual(['Sulfa drugs']);
        expect(addTag(['Penicillin'], 'penicillin').list).toEqual(['Penicillin']);
        expect(addTag(['Penicillin'], '   ').list).toEqual(['Penicillin']);
    });
    it('splits commas and new lines', () => {
        expect(addTags([], 'Penicillin, Aspirin\nPeanuts,,').list).toEqual(['Penicillin', 'Aspirin', 'Peanuts']);
    });
    it('keeps to the server limits', () => {
        expect(addTag([], 'x'.repeat(81)).error).toMatch(/80/);
        const full = Array.from({ length: TAG_MAX_COUNT }, (_, i) => `A${i}`);
        expect(addTag(full, 'One more')).toEqual({ list: full, error: `Add at most ${TAG_MAX_COUNT}.` });
    });
});

describe('healthBody', () => {
    it('sends "no known allergies" as the flag, and a list otherwise', () => {
        const none = { ...formFromPerson(person), noKnownAllergies: true };
        expect(healthBody(none, true)).toEqual({ noKnownAllergies: true });
        expect(healthBody({ ...none, noKnownAllergies: false, allergies: ['Latex'] }, true)).toEqual({ allergies: ['Latex'] });
    });
    it('the quick prompt sends only allergies, so it never wipes conditions or medicines', () => {
        const f = formFromPerson({ ...person, chronicConditions: ['Diabetes'], currentMedications: ['Metformin'], allergies: ['Latex'], allergiesConfirmedAt: 'x' });
        expect(Object.keys(healthBody(f, true))).toEqual(['allergies']);
        expect(healthBody(f)).toEqual({ allergies: ['Latex'], chronicConditions: ['Diabetes'], currentMedications: ['Metformin'], bloodGroup: null });
    });
    it('starts the form ticked only when "none" was confirmed', () => {
        expect(formFromPerson({ ...person, allergiesConfirmedAt: 'x' }).noKnownAllergies).toBe(true);
        expect(formFromPerson(person).noKnownAllergies).toBe(false);
    });
});
