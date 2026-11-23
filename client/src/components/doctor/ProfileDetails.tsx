'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { pendingChange, validateProfileForm, withChange, type ProfileForm } from '@/lib/consult/changes';
import type { ProfileChange } from '@/lib/consult/types';
import { ChangeNotice } from './ChangeNotice';
import { useDoctor } from './DoctorContext';

const fieldClass = 'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/** Bio, languages and experience are shown to patients, so a change waits for a DocNow admin. */
export function ProfileDetails() {
    const { doctor, setDoctor } = useDoctor();
    const toForm = (): ProfileForm => {
        const wanted = { bio: doctor.bio, languages: doctor.languages, experienceYears: doctor.experienceYears, ...(pendingChange(doctor.changeRequests, 'PROFILE')?.payload as ProfileChange | undefined) };
        return { bio: wanted.bio ?? '', languages: (wanted.languages ?? []).join(', '), experienceYears: String(wanted.experienceYears ?? 0) };
    };
    const [form, setForm] = useState<ProfileForm>(toForm);
    const [errors, setErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const set = (key: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }));
        setMessage(null);
    };

    async function send() {
        setMessage(null);
        setFormError(null);
        const checked = validateProfileForm(form);
        if (!checked.ok) {
            setErrors(checked.errors);
            return;
        }
        setErrors({});
        setBusy(true);
        try {
            const { doctor: live, request } = await doctorApi.updateMe(checked.value);
            setDoctor({ ...doctor, ...live, changeRequests: withChange(doctor.changeRequests, 'PROFILE', request) });
            setMessage(request ? 'Sent for approval. Patients see the new details once a DocNow admin approves them.' : 'These are already your details, so there is nothing to approve.');
        } catch (e) {
            setFormError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3">
            <ChangeNotice kind="PROFILE" onWithdrawn={() => setForm({ bio: doctor.bio ?? '', languages: doctor.languages.join(', '), experienceYears: String(doctor.experienceYears) })} />
            <div>
                <label htmlFor="doctor-bio" className="mb-1 block text-sm font-semibold text-foreground">About you</label>
                <textarea id="doctor-bio" rows={4} value={form.bio} onChange={set('bio')} aria-invalid={!!errors.bio} className={fieldClass}
                    placeholder="Your training, what you treat, how you like to work with patients" />
                {errors.bio && <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors.bio}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <div>
                    <label htmlFor="doctor-languages" className="mb-1 block text-sm font-semibold text-foreground">Languages you consult in</label>
                    <input id="doctor-languages" value={form.languages} onChange={set('languages')} aria-invalid={!!errors.languages} className={`${fieldClass} h-11`}
                        placeholder="English, Hindi" aria-describedby="doctor-languages-hint" />
                    {errors.languages
                        ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors.languages}</p>
                        : <p id="doctor-languages-hint" className="mt-1 text-xs text-ink-muted">Separate them with commas.</p>}
                </div>
                <div>
                    <label htmlFor="doctor-experience" className="mb-1 block text-sm font-semibold text-foreground">Years of experience</label>
                    <input id="doctor-experience" inputMode="numeric" value={form.experienceYears} onChange={set('experienceYears')} aria-invalid={!!errors.experienceYears}
                        className={`${fieldClass} h-11`} />
                    {errors.experienceYears && <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors.experienceYears}</p>}
                </div>
            </div>
            {formError && <p role="alert" className="text-sm font-medium text-destructive">{formError}</p>}
            {message && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{message}</p>}
            <Button type="button" onClick={send} disabled={busy} className="w-full sm:w-auto">{busy ? 'Sending...' : 'Send for approval'}</Button>
        </div>
    );
}
