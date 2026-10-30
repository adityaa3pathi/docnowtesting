/**
 * The eight specialties the homepage leads with. `key` is what the homepage links use
 * (/consult?specialty=<key>); /consult maps it to whatever this deployment calls the specialty,
 * by exact slug first and then by `match` against the specialty's slug and name.
 */
import type { Specialty } from '@/lib/consult/types';

export interface HomeSpecialty {
    key: string;
    name: string;
    symptoms: string[];
    match: RegExp;
}

export const HOME_SPECIALTIES: HomeSpecialty[] = [
    { key: 'general-physician', name: 'General Physician', symptoms: ['Fever', 'Cold & cough', 'Headache', 'Fatigue'], match: /general|physician|family|internal/ },
    { key: 'dermatologist', name: 'Dermatologist', symptoms: ['Acne', 'Skin allergy', 'Hair fall'], match: /derma|skin/ },
    { key: 'gynecologist', name: 'Gynecologist', symptoms: ['PCOS', 'Periods', 'Pregnancy'], match: /gyn|obst|women/ },
    { key: 'pediatrician', name: 'Pediatrician', symptoms: ['Child health', 'Cough', 'Vaccinations'], match: /pa?ediat|child|neonat/ },
    { key: 'orthopedist', name: 'Orthopedist', symptoms: ['Joint pain', 'Arthritis', 'Back & neck'], match: /ortho|bone|joint/ },
    { key: 'cardiologist', name: 'Cardiologist', symptoms: ['Blood pressure', 'Chest discomfort', 'Heart care'], match: /cardi|heart/ },
    { key: 'psychiatrist', name: 'Psychiatrist', symptoms: ['Stress', 'Anxiety', 'Sleep issues'], match: /psych|mental/ },
    { key: 'gastroenterologist', name: 'Gastroenterologist', symptoms: ['Acidity', 'Digestion', 'Stomach pain'], match: /gastro|liver|digest/ },
];

export const specialtyHref = (key: string) => `/consult?specialty=${encodeURIComponent(key)}`;

/** The deployment's specialty a `?specialty=` value stands for, or null when it offers none like it. */
export function resolveSpecialty(param: string | null | undefined, specialties: Specialty[]): Specialty | null {
    const value = param?.trim().toLowerCase();
    if (!value) return null;
    const exact = specialties.find((s) => s.slug.toLowerCase() === value || s.id === param);
    if (exact) return exact;
    const known = HOME_SPECIALTIES.find((h) => h.key === value);
    if (!known) return null;
    return specialties.find((s) => known.match.test(`${s.slug} ${s.name}`.toLowerCase())) ?? null;
}

/** "dermatologist" → "Dermatologist", for the "no doctors like this yet" notice. */
export const specialtyLabel = (param: string) =>
    HOME_SPECIALTIES.find((h) => h.key === param.toLowerCase())?.name ?? param.replace(/[-_]+/g, ' ');
