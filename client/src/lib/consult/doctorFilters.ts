import type { DoctorSummary } from './types';

export type DoctorSort = 'recommended' | 'soonest' | 'fee_low' | 'fee_high' | 'experience';

export interface DoctorFilterState {
    languages: string[];
    gender: 'Female' | 'Male' | null;
    minExperience: number | null;
    maxFee: number | null;
    sort: DoctorSort;
}

export const NO_FILTERS: DoctorFilterState = { languages: [], gender: null, minExperience: null, maxFee: null, sort: 'recommended' };

export const SORT_LABELS: Record<DoctorSort, string> = {
    recommended: 'Recommended',
    soonest: 'Available soonest',
    fee_low: 'Fee: low to high',
    fee_high: 'Fee: high to low',
    experience: 'Most experienced',
};
export const EXPERIENCE_STEPS = [5, 10, 15, 20];
export const FEE_STEPS = [300, 500, 800, 1000];

const soonest = (d: DoctorSummary) => (d.nextSlotAt ? Date.parse(d.nextSlotAt) : Number.POSITIVE_INFINITY);

/** Languages offered by these doctors, most common first, so the menu only lists real choices. */
export function languageOptions(doctors: DoctorSummary[]): string[] {
    const count = new Map<string, number>();
    for (const d of doctors) for (const l of d.languages) count.set(l, (count.get(l) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

export function activeFilterCount(f: DoctorFilterState): number {
    return (f.languages.length ? 1 : 0) + (f.gender ? 1 : 0) + (f.minExperience !== null ? 1 : 0) + (f.maxFee !== null ? 1 : 0);
}

/** Doctors matching every chosen filter (any chosen language), in the chosen order. */
export function applyDoctorFilters(doctors: DoctorSummary[], f: DoctorFilterState): DoctorSummary[] {
    const kept = doctors.filter((d) =>
        (f.languages.length === 0 || f.languages.some((l) => d.languages.includes(l)))
        && (!f.gender || d.gender === f.gender)
        && (f.minExperience === null || d.experienceYears >= f.minExperience)
        && (f.maxFee === null || d.consultationFee <= f.maxFee));
    const by: Record<DoctorSort, (a: DoctorSummary, b: DoctorSummary) => number> = {
        // Who can see you soonest, then experience: the order most patients pick by.
        recommended: (a, b) => soonest(a) - soonest(b) || b.experienceYears - a.experienceYears,
        soonest: (a, b) => soonest(a) - soonest(b),
        fee_low: (a, b) => a.consultationFee - b.consultationFee,
        fee_high: (a, b) => b.consultationFee - a.consultationFee,
        experience: (a, b) => b.experienceYears - a.experienceYears,
    };
    return [...kept].sort((a, b) => by[f.sort](a, b) || a.displayName.localeCompare(b.displayName));
}
