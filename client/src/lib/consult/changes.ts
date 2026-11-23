/** Pure helpers for doctor changes that wait for super-admin approval (new hours, profile text). */
import type { AvailabilityWindow, DoctorChangeKind, DoctorChangeRequest, HoursChange, ProfileChange } from './types';
import { windowsToForm } from './availability';
import { WEEKDAYS } from './time';

export const CHANGE_KIND_LABEL: Record<DoctorChangeKind, string> = {
    AVAILABILITY: 'Weekly hours',
    PROFILE: 'Profile details',
};

/** The change of this kind still waiting for approval, if any. */
export function pendingChange(changes: DoctorChangeRequest[] | undefined, kind: DoctorChangeKind): DoctorChangeRequest | null {
    return changes?.find((c) => c.kind === kind && c.status === 'PENDING') ?? null;
}

/** The newest decided change of this kind, unless a newer one is waiting or was taken back. */
export function lastDecision(changes: DoctorChangeRequest[] | undefined, kind: DoctorChangeKind): DoctorChangeRequest | null {
    const newest = changes?.find((c) => c.kind === kind);
    return newest && (newest.status === 'APPROVED' || newest.status === 'REJECTED') ? newest : null;
}

/**
 * The doctor's list after sending a change: the new pending request goes first and replaces the old
 * pending one of its kind. `request` null means nothing is waiting any more (taken back, or it matched
 * the live values): the old pending one is kept as withdrawn, so an older rejection is not news again.
 */
export function withChange(changes: DoctorChangeRequest[] | undefined, kind: DoctorChangeKind, request: DoctorChangeRequest | null): DoctorChangeRequest[] {
    const list = changes ?? [];
    const isPending = (c: DoctorChangeRequest) => c.kind === kind && c.status === 'PENDING';
    if (request) return [request, ...list.filter((c) => !isPending(c))];
    return list.map((c) => (isPending(c) ? { ...c, status: 'WITHDRAWN' as const } : c));
}

export function dayHoursText(windows: AvailabilityWindow[], day: number): string {
    const ranges = windowsToForm(windows)[day] ?? [];
    return ranges.length ? ranges.map((r) => `${r.start} to ${r.end}`).join(', ') : 'Not available';
}

export interface DiffRow {
    label: string;
    before: string;
    after: string;
    changed: boolean;
}

const row = (label: string, before: string, after: string): DiffRow => ({ label, before, after, changed: before !== after });

/** Slot length, then one row per weekday, Monday first. */
export function hoursDiff(before: HoursChange, after: HoursChange): DiffRow[] {
    const days = [1, 2, 3, 4, 5, 6, 0].map((d) => row(WEEKDAYS[d], dayHoursText(before.windows, d), dayHoursText(after.windows, d)));
    return [row('Appointment length', `${before.slotMinutes} minutes`, `${after.slotMinutes} minutes`), ...days];
}

const PROFILE_ROWS: { key: keyof ProfileChange; label: string; text: (v: ProfileChange) => string }[] = [
    { key: 'bio', label: 'About you', text: (v) => v.bio?.trim() || 'Not written yet' },
    { key: 'languages', label: 'Languages', text: (v) => (v.languages?.length ? v.languages.join(', ') : 'None') },
    { key: 'experienceYears', label: 'Experience', text: (v) => `${v.experienceYears ?? 0} years` },
];

/** Only the fields the request changes. */
export function profileDiff(before: ProfileChange, after: ProfileChange): DiffRow[] {
    return PROFILE_ROWS.filter((r) => after[r.key] !== undefined).map((r) => row(r.label, r.text(before), r.text(after)));
}

export function changeDiff(kind: DoctorChangeKind, before: HoursChange | ProfileChange, after: HoursChange | ProfileChange): DiffRow[] {
    return kind === 'AVAILABILITY' ? hoursDiff(before as HoursChange, after as HoursChange) : profileDiff(before as ProfileChange, after as ProfileChange);
}

export interface ProfileForm {
    bio: string;
    languages: string;
    experienceYears: string;
}

/** Checks the doctor's profile form and turns it into the request body, or returns plain-words errors. */
export function validateProfileForm(form: ProfileForm):
    | { ok: true; value: { bio: string; languages: string[]; experienceYears: number } }
    | { ok: false; errors: Partial<Record<keyof ProfileForm, string>> } {
    const errors: Partial<Record<keyof ProfileForm, string>> = {};
    const languages = [...new Set(form.languages.split(',').map((l) => l.trim()).filter(Boolean))];
    if (languages.length === 0) errors.languages = 'Add at least one language.';
    else if (languages.some((l) => l.length < 2)) errors.languages = 'Write each language in full, for example Hindi.';
    const years = Number(form.experienceYears);
    if (form.experienceYears.trim() === '' || !Number.isInteger(years) || years < 0 || years > 70) errors.experienceYears = 'Enter whole years, from 0 to 70.';
    if (form.bio.trim().length > 1000) errors.bio = 'Keep it under 1000 characters.';
    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, value: { bio: form.bio.trim(), languages, experienceYears: years } };
}
