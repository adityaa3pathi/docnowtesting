import { describe, expect, it } from 'vitest';
import { doseTimesLabel, medicineParts, medicineSchema } from './consultations.medicine';
import { dosageSummary } from './consultations.familyMessages';
import { prescriptionSchema } from './consultations.prescription';

describe('medicineSchema', () => {
    it('fills the structured fields with empty values when a client leaves them out', () => {
        expect(medicineSchema.parse({ name: 'Paracetamol' })).toEqual({
            name: 'Paracetamol', strength: '', dose: '', frequency: '', doseTimes: [], foodTiming: null,
            durationDays: null, duration: '', instructions: '',
        });
    });

    it('keeps dose times in morning, afternoon, night order without repeats', () => {
        expect(medicineSchema.parse({ name: 'X', doseTimes: ['NIGHT', 'MORNING', 'NIGHT'] }).doseTimes).toEqual(['MORNING', 'NIGHT']);
    });

    it('rejects unknown times and food timings, and durations outside 1 to 365 days', () => {
        expect(medicineSchema.safeParse({ name: 'X', doseTimes: ['NOON'] }).success).toBe(false);
        expect(medicineSchema.safeParse({ name: 'X', foodTiming: 'AFTER_LUNCH' }).success).toBe(false);
        expect(medicineSchema.safeParse({ name: 'X', durationDays: 0 }).success).toBe(false);
        expect(medicineSchema.safeParse({ name: 'X', durationDays: 366 }).success).toBe(false);
        expect(medicineSchema.safeParse({ name: 'X', durationDays: 2.5 }).success).toBe(false);
        expect(medicineSchema.safeParse({ name: 'X', strength: 'x'.repeat(41) }).success).toBe(false);
    });

    it('is what the prescription schema uses', () => {
        const p = prescriptionSchema.parse({ medicines: [{ name: 'Cetirizine', strength: '10 mg', doseTimes: ['NIGHT'], foodTiming: 'AFTER_FOOD', durationDays: 5 }] });
        expect(p.medicines[0]).toMatchObject({ strength: '10 mg', doseTimes: ['NIGHT'], foodTiming: 'AFTER_FOOD', durationDays: 5 });
    });
});

describe('medicineParts', () => {
    it('writes the times the Indian way', () => {
        expect(doseTimesLabel(['MORNING', 'NIGHT'])).toBe('1-0-1 (morning, night)');
        expect(doseTimesLabel(['AFTERNOON'])).toBe('0-1-0 (afternoon)');
        expect(doseTimesLabel([])).toBe('');
        expect(doseTimesLabel(undefined)).toBe('');
    });

    it('reads a structured medicine', () => {
        expect(medicineParts({
            name: 'Paracetamol', strength: '650 mg', dose: '1 tablet', frequency: '', doseTimes: ['MORNING', 'NIGHT'],
            foodTiming: 'AFTER_FOOD', durationDays: 5, duration: '', instructions: 'Stop if the fever goes',
        })).toEqual({
            title: 'Paracetamol 650 mg', dose: '1 tablet', when: '1-0-1 (morning, night)', food: 'After food', duration: '5 days',
            instructions: 'Stop if the fever goes',
        });
        expect(medicineParts({ name: 'X', durationDays: 1 }).duration).toBe('1 day');
    });

    it('reads a prescription issued before the structured fields existed', () => {
        expect(medicineParts({ name: 'Azithromycin', dose: '500 mg', frequency: 'Once a day', duration: '3 days', instructions: 'After food' })).toEqual({
            title: 'Azithromycin', dose: '500 mg', when: 'Once a day', food: '', duration: '3 days', instructions: 'After food',
        });
    });

    it('ignores a food timing it does not know (a newer client)', () => {
        expect(medicineParts({ name: 'X', foodTiming: 'AT_BEDTIME' }).food).toBe('');
    });
});

describe('dosageSummary with structured medicines', () => {
    it('writes the structured fields in simple Hindi', () => {
        expect(dosageSummary([{ name: 'Paracetamol', strength: '650 mg', doseTimes: ['MORNING', 'NIGHT'], foodTiming: 'EMPTY_STOMACH', durationDays: 5 }], 'hi'))
            .toBe('1. Paracetamol 650 mg: 1-0-1 (सुबह, रात), खाली पेट, 5 दिन');
        expect(dosageSummary([{ name: 'Paracetamol', strength: '650 mg', doseTimes: ['MORNING'], foodTiming: 'BEFORE_FOOD', durationDays: 1 }], 'en'))
            .toBe('1. Paracetamol 650 mg: 1-0-0 (morning), Before food, 1 day');
    });
});
