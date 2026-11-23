import { describe, expect, it } from 'vitest';
import { doseTimesLabel, medicineParts } from './medicine';

describe('medicineParts', () => {
    it('reads a structured medicine', () => {
        expect(medicineParts({
            name: 'Paracetamol', strength: '650 mg', dose: '1 tablet', frequency: '', doseTimes: ['MORNING', 'NIGHT'],
            foodTiming: 'AFTER_FOOD', durationDays: 5, duration: '', instructions: 'Stop if the fever goes',
        })).toEqual({ title: 'Paracetamol 650 mg', plan: ['1 tablet', '1-0-1 (morning, night)', 'After food', '5 days'], instructions: 'Stop if the fever goes' });
    });
    it('still reads a prescription issued before the structured fields', () => {
        expect(medicineParts({ name: 'Azithromycin', dose: '500 mg', frequency: 'Once a day', duration: '3 days', instructions: 'After food' }))
            .toEqual({ title: 'Azithromycin', plan: ['500 mg', 'Once a day', '3 days'], instructions: 'After food' });
    });
    it('writes times the Indian way and one day in the singular', () => {
        expect(doseTimesLabel(['NIGHT', 'AFTERNOON'])).toBe('0-1-1 (afternoon, night)');
        expect(medicineParts({ name: 'X', durationDays: 1 }).plan).toEqual(['1 day']);
    });
});
