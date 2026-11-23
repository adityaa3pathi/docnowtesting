/**
 * A person's health details (self or family): allergies, conditions, medicines, blood group.
 * Pure rules here, kept apart from React so they can be tested.
 */
import api from '@/lib/api';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
/** Must match the server's tagList in patientValidation.ts. */
export const TAG_MAX_LENGTH = 80;
export const TAG_MAX_COUNT = 20;

export interface HealthPerson {
    id: string;
    name: string;
    relation: string;
    age: number;
    gender: string;
    bloodGroup?: string | null;
    allergies?: string[];
    /** Set when the allergies were confirmed; with an empty list it means "no known allergies". */
    allergiesConfirmedAt?: string | null;
    chronicConditions?: string[];
    currentMedications?: string[];
}

/** listed: has allergies · none: confirmed none · unknown: nobody has asked yet. */
export type AllergyState = 'listed' | 'none' | 'unknown';

export function allergyState(p: { allergies?: string[]; allergiesConfirmedAt?: string | null }): AllergyState {
    if (p.allergies?.length) return 'listed';
    return p.allergiesConfirmedAt ? 'none' : 'unknown';
}

/** Adds a typed entry: trimmed, no repeats (any case), within the server's limits. */
export function addTag(list: string[], raw: string): { list: string[]; error?: string } {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) return { list };
    if (value.length > TAG_MAX_LENGTH) return { list, error: `Keep each entry under ${TAG_MAX_LENGTH} characters.` };
    if (list.some((x) => x.toLowerCase() === value.toLowerCase())) return { list };
    if (list.length >= TAG_MAX_COUNT) return { list, error: `Add at most ${TAG_MAX_COUNT}.` };
    return { list: [...list, value] };
}

/** Adds every comma- or line-separated entry of a pasted or typed text. */
export function addTags(list: string[], text: string): { list: string[]; error?: string } {
    let out = { list } as { list: string[]; error?: string };
    for (const part of text.split(/[,\n]/)) {
        const next = addTag(out.list, part);
        out = { list: next.list, error: next.error ?? out.error };
    }
    return out;
}

export interface HealthForm {
    allergies: string[];
    noKnownAllergies: boolean;
    chronicConditions: string[];
    currentMedications: string[];
    bloodGroup: string;
}

export function formFromPerson(p: HealthPerson): HealthForm {
    return {
        allergies: p.allergies ?? [],
        noKnownAllergies: allergyState(p) === 'none',
        chronicConditions: p.chronicConditions ?? [],
        currentMedications: p.currentMedications ?? [],
        bloodGroup: p.bloodGroup ?? '',
    };
}

/**
 * The PATCH body. `allergiesOnly` sends just the allergy part, for the quick prompts, so they never
 * overwrite conditions or medicines the person did not see.
 */
export function healthBody(f: HealthForm, allergiesOnly = false): Record<string, unknown> {
    const allergy = f.noKnownAllergies && !f.allergies.length ? { noKnownAllergies: true } : { allergies: f.allergies };
    if (allergiesOnly) return allergy;
    return {
        ...allergy,
        chronicConditions: f.chronicConditions,
        currentMedications: f.currentMedications,
        bloodGroup: f.bloodGroup || null,
    };
}

export const healthApi = {
    /** Makes sure the account's own "Self" person exists; a thin profile is fine to skip. */
    ensureSelf: () => api.post<HealthPerson>('/profile/patients/ensure-self').then((r) => r.data),
    people: () => api.get<HealthPerson[]>('/profile/patients').then((r) => r.data),
    save: (id: string, body: Record<string, unknown>) =>
        api.patch<{ patient: HealthPerson }>(`/profile/patients/${id}`, body).then((r) => r.data.patient),
};

export const isSelfPerson = (p: { relation?: string }) => p.relation?.toLowerCase() === 'self';
