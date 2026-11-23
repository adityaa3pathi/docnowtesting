/** How a prescribed medicine reads on screen. Mirrors the server's consultations.medicine.ts. */
import type { DoseTime, FoodTiming, Medicine } from './types';

export const DOSE_TIMES: { value: DoseTime; label: string }[] = [
    { value: 'MORNING', label: 'Morning' },
    { value: 'AFTERNOON', label: 'Afternoon' },
    { value: 'NIGHT', label: 'Night' },
];

export const FOOD_TIMINGS: { value: FoodTiming; label: string }[] = [
    { value: 'BEFORE_FOOD', label: 'Before food' },
    { value: 'AFTER_FOOD', label: 'After food' },
    { value: 'WITH_FOOD', label: 'With food' },
    { value: 'EMPTY_STOMACH', label: 'Empty stomach' },
];

/** ["MORNING", "NIGHT"] → "1-0-1 (morning, night)". */
export function doseTimesLabel(times: readonly string[] | undefined): string {
    const set = DOSE_TIMES.filter((t) => times?.includes(t.value));
    if (!set.length) return '';
    const pattern = DOSE_TIMES.map((t) => (set.includes(t) ? '1' : '0')).join('-');
    return `${pattern} (${set.map((t) => t.label.toLowerCase()).join(', ')})`;
}

/** Heading ("Paracetamol 650 mg") and plan parts in reading order; works for old prescriptions too. */
export function medicineParts(m: Partial<Medicine> & { name: string }) {
    const clean = (v: string | undefined | null) => v?.trim() ?? '';
    const food = FOOD_TIMINGS.find((f) => f.value === m.foodTiming)?.label ?? '';
    const duration = m.durationDays ? `${m.durationDays} ${m.durationDays === 1 ? 'day' : 'days'}` : clean(m.duration);
    return {
        title: [clean(m.name), clean(m.strength)].filter(Boolean).join(' '),
        plan: [clean(m.dose), doseTimesLabel(m.doseTimes), clean(m.frequency), food, duration].filter(Boolean),
        instructions: clean(m.instructions),
    };
}
