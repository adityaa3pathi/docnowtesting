/**
 * One prescribed medicine: the input schema and how it reads on the PDF and in WhatsApp.
 *
 * Prescriptions are stored as JSON and never rewritten, so a medicine issued before the
 * structured fields existed has only the free-text ones (dose, frequency, duration,
 * instructions). Every reader goes through `medicineParts`, which handles both shapes.
 * The structured fields (strength, doseTimes, foodTiming, durationDays) are what medicine
 * reminders will be built from.
 */
import { z } from 'zod';

export const DOSE_TIMES = ['MORNING', 'AFTERNOON', 'NIGHT'] as const;
export const FOOD_TIMINGS = ['BEFORE_FOOD', 'AFTER_FOOD', 'WITH_FOOD', 'EMPTY_STOMACH'] as const;
export type DoseTime = (typeof DOSE_TIMES)[number];
export type FoodTiming = (typeof FOOD_TIMINGS)[number];

// English wording the Hindi WhatsApp text knows how to translate (consultations.familyMessages.ts).
const FOOD_LABEL: Record<FoodTiming, string> = {
    BEFORE_FOOD: 'Before food',
    AFTER_FOOD: 'After food',
    WITH_FOOD: 'With food',
    EMPTY_STOMACH: 'Empty stomach',
};

export const medicineSchema = z.object({
    name: z.string().trim().min(1, 'Medicine name is required').max(120),
    /** e.g. "650 mg", "5 ml". */
    strength: z.string().trim().max(40).default(''),
    /** How much each time, e.g. "1 tablet". */
    dose: z.string().trim().max(60).default(''),
    /** Free text for patterns the times can't express: "Only when needed", "Once a week". */
    frequency: z.string().trim().max(60).default(''),
    doseTimes: z.array(z.enum(DOSE_TIMES, { message: 'Times must be morning, afternoon or night' })).max(3)
        .default([])
        .transform((times) => DOSE_TIMES.filter((t) => times.includes(t))),
    foodTiming: z.enum(FOOD_TIMINGS, { message: 'Unknown food timing' }).nullable().default(null),
    durationDays: z.number().int().min(1, 'Duration must be at least 1 day').max(365, 'Duration must be at most 365 days').nullable().default(null),
    /** Old free-text duration ("5 days"); kept so a correction of an old prescription keeps it. */
    duration: z.string().trim().max(60).default(''),
    instructions: z.string().trim().max(200).default(''),
});

/** A medicine as stored: any issued version, old or new. */
export type StoredMedicine = {
    name: string;
    strength?: string;
    dose?: string;
    frequency?: string;
    doseTimes?: string[];
    foodTiming?: string | null;
    durationDays?: number | null;
    duration?: string;
    instructions?: string;
};

/** ["MORNING", "NIGHT"] → "1-0-1 (morning, night)", the way Indian prescriptions write it. */
export function doseTimesLabel(times: readonly string[] | undefined): string {
    const set = DOSE_TIMES.filter((t) => times?.includes(t));
    if (!set.length) return '';
    const pattern = DOSE_TIMES.map((t) => (set.includes(t) ? '1' : '0')).join('-');
    return `${pattern} (${set.map((t) => t.toLowerCase()).join(', ')})`;
}

export const durationLabel = (m: StoredMedicine): string =>
    m.durationDays ? `${m.durationDays} ${m.durationDays === 1 ? 'day' : 'days'}` : (m.duration ?? '');

/** The medicine's heading ("Paracetamol 650 mg") and each part of its plan; empty parts are ''. */
export function medicineParts(m: StoredMedicine) {
    const food = m.foodTiming && m.foodTiming in FOOD_LABEL ? FOOD_LABEL[m.foodTiming as FoodTiming] : '';
    const clean = (v: string | undefined) => v?.trim() ?? '';
    return {
        title: [clean(m.name), clean(m.strength)].filter(Boolean).join(' '),
        dose: clean(m.dose),
        when: [doseTimesLabel(m.doseTimes), clean(m.frequency)].filter(Boolean).join(', '),
        food,
        duration: clean(durationLabel(m)),
        instructions: clean(m.instructions),
    };
}
