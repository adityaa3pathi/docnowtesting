import { describe, expect, it } from 'vitest';
import { hoursDiff, lastDecision, pendingChange, profileDiff, validateProfileForm, withChange } from './changes';
import type { DoctorChangeRequest } from './types';

const req = (over: Partial<DoctorChangeRequest>): DoctorChangeRequest => ({
    id: 'r1', kind: 'AVAILABILITY', status: 'PENDING', payload: { windows: [], slotMinutes: 15 }, previous: { windows: [], slotMinutes: 15 },
    reviewReason: null, createdAt: '2026-11-23T05:00:00.000Z', reviewedAt: null, ...over,
});

describe('pending and last decision', () => {
    it('finds the pending change per kind', () => {
        const list = [req({ id: 'a', kind: 'PROFILE' }), req({ id: 'b', status: 'REJECTED' })];
        expect(pendingChange(list, 'PROFILE')?.id).toBe('a');
        expect(pendingChange(list, 'AVAILABILITY')).toBeNull();
        expect(pendingChange(undefined, 'PROFILE')).toBeNull();
    });

    it('shows the last decision only when nothing newer is waiting', () => {
        expect(lastDecision([req({ id: 'old', status: 'REJECTED', reviewReason: 'No' })], 'AVAILABILITY')?.reviewReason).toBe('No');
        expect(lastDecision([req({ id: 'new' }), req({ id: 'old', status: 'REJECTED' })], 'AVAILABILITY')).toBeNull();
    });

    it('a resend replaces the pending one; null removes it', () => {
        const list = [req({ id: 'p' }), req({ id: 'x', kind: 'PROFILE' }), req({ id: 'done', status: 'APPROVED' })];
        expect(withChange(list, 'AVAILABILITY', req({ id: 'n' })).map((c) => c.id)).toEqual(['n', 'x', 'done']);
        expect(withChange(list, 'AVAILABILITY', null).map((c) => c.id)).toEqual(['x', 'done']);
    });
});

describe('diffs', () => {
    it('lists slot length and every weekday from Monday, marking what changed', () => {
        const rows = hoursDiff(
            { slotMinutes: 15, windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 780 }] },
            { slotMinutes: 20, windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 780 }, { dayOfWeek: 0, startMinute: 600, endMinute: 660 }] },
        );
        expect(rows[0]).toEqual({ label: 'Appointment length', before: '15 minutes', after: '20 minutes', changed: true });
        expect(rows[1]).toEqual({ label: 'Monday', before: '09:00 to 13:00', after: '09:00 to 13:00', changed: false });
        expect(rows[7]).toEqual({ label: 'Sunday', before: 'Not available', after: '10:00 to 11:00', changed: true });
        expect(rows).toHaveLength(8);
    });

    it('shows only the profile fields the request changes', () => {
        expect(profileDiff({ bio: null, languages: ['English'] }, { bio: 'Family doctor' })).toEqual([
            { label: 'About you', before: 'Not written yet', after: 'Family doctor', changed: true },
        ]);
    });
});

describe('profile form', () => {
    it('cleans languages and turns years into a number', () => {
        expect(validateProfileForm({ bio: '  Hi  ', languages: 'English, Hindi, ,Hindi', experienceYears: '12' }))
            .toEqual({ ok: true, value: { bio: 'Hi', languages: ['English', 'Hindi'], experienceYears: 12 } });
    });

    it('explains each problem in plain words', () => {
        const res = validateProfileForm({ bio: 'x'.repeat(1001), languages: ' , ', experienceYears: '2.5' });
        expect(res).toEqual({ ok: false, errors: {
            bio: 'Keep it under 1000 characters.', languages: 'Add at least one language.', experienceYears: 'Enter whole years, from 0 to 70.',
        } });
    });
});
