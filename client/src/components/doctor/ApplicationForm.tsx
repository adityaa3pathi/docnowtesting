'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Card } from '@/components/ui';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { consult, doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import type { DoctorMe } from '@/lib/consult/types';

/** Mirrors the server limits so most mistakes are caught before sending. */
const schema = z.object({
    displayName: z.string().trim().min(2, 'Enter your name.'),
    specialtyId: z.string().min(1, 'Choose a specialty.'),
    qualification: z.string().trim().min(2, 'Enter your qualification.'),
    registrationNumber: z.string().trim().min(3, 'Enter your registration number.'),
    registrationCouncil: z.string().trim().min(2, 'Enter your registration council.'),
    experienceYears: z.string().trim().regex(/^\d{1,2}$/, 'Enter whole years, 0 to 70.').refine((v) => Number(v) <= 70, 'Enter whole years, 0 to 70.'),
    languages: z.string().refine((v) => splitLanguages(v).length >= 1, 'Add at least one language.')
        .refine((v) => splitLanguages(v).every((l) => l.length >= 2), 'Each language needs at least 2 letters.'),
    bio: z.string().trim().max(1000, 'Keep your bio under 1000 characters.'),
    photoUrl: z.string().trim().refine((v) => v === '' || isWebAddress(v), 'Enter a full web address, like https://example.com/photo.jpg.'),
});
type FormValues = z.infer<typeof schema>;

const splitLanguages = (text: string) => text.split(',').map((l) => l.trim()).filter(Boolean);
function isWebAddress(v: string) {
    try {
        return ['http:', 'https:'].includes(new URL(v).protocol);
    } catch {
        return false;
    }
}

const fieldClass = 'w-full rounded-xl border border-border bg-white px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
    return (
        <div>
            <label htmlFor={id} className="mb-1 block text-sm font-semibold text-foreground">{label}</label>
            {children}
            {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
            {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-destructive">{error}</p>}
        </div>
    );
}

export function ApplicationForm({ existing, onDone }: { existing?: DoctorMe; onDone: (d: DoctorMe) => void }) {
    const specialties = useApi(() => consult.specialties());
    const [formError, setFormError] = useState<string | null>(null);
    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            displayName: existing?.displayName ?? '',
            specialtyId: existing?.specialtyId ?? '',
            qualification: existing?.qualification ?? '',
            registrationNumber: existing?.registrationNumber ?? '',
            registrationCouncil: existing?.registrationCouncil ?? '',
            experienceYears: String(existing?.experienceYears ?? 0),
            languages: existing?.languages.join(', ') ?? '',
            bio: existing?.bio ?? '',
            photoUrl: existing?.photoUrl ?? '',
        },
    });

    const submit = handleSubmit(async (v) => {
        setFormError(null);
        const body = {
            displayName: v.displayName,
            specialtyId: v.specialtyId,
            qualification: v.qualification,
            registrationNumber: v.registrationNumber,
            registrationCouncil: v.registrationCouncil,
            experienceYears: Number(v.experienceYears),
            languages: splitLanguages(v.languages),
            ...(v.bio ? { bio: v.bio } : {}),
            ...(v.photoUrl ? { photoUrl: v.photoUrl } : {}),
        };
        try {
            onDone(existing ? await doctorApi.resubmit(body) : await doctorApi.register(body));
        } catch (e) {
            setFormError(errorMessage(e));
        }
    });

    if (specialties.loading) return <LoadingBlock label="Loading the form" />;
    if (specialties.error) return <ErrorState message={specialties.error} onRetry={specialties.refetch} />;
    const list = (specialties.data ?? []).filter((s) => s.isActive);

    return (
        <Card className="p-5 sm:p-8">
            <form onSubmit={submit} noValidate className="space-y-5" aria-label="Doctor application">
                {formError && (
                    <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-destructive">{formError}</div>
                )}
                <Field id="displayName" label="Your name" error={errors.displayName?.message}>
                    <input id="displayName" className={fieldClass} autoComplete="name" aria-invalid={!!errors.displayName} {...register('displayName')} />
                </Field>
                <Field id="specialtyId" label="Specialty" error={errors.specialtyId?.message}>
                    <select id="specialtyId" className={fieldClass} aria-invalid={!!errors.specialtyId} {...register('specialtyId')}>
                        <option value="">Choose a specialty</option>
                        {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </Field>
                <Field id="qualification" label="Qualification" hint="For example MBBS, MD (Medicine)." error={errors.qualification?.message}>
                    <input id="qualification" className={fieldClass} aria-invalid={!!errors.qualification} {...register('qualification')} />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                    <Field id="registrationNumber" label="Registration number" error={errors.registrationNumber?.message}>
                        <input id="registrationNumber" className={fieldClass} aria-invalid={!!errors.registrationNumber} {...register('registrationNumber')} />
                    </Field>
                    <Field id="registrationCouncil" label="Registration council" hint="For example Delhi Medical Council." error={errors.registrationCouncil?.message}>
                        <input id="registrationCouncil" className={fieldClass} aria-invalid={!!errors.registrationCouncil} {...register('registrationCouncil')} />
                    </Field>
                </div>
                <Field id="experienceYears" label="Years of experience" error={errors.experienceYears?.message}>
                    <input id="experienceYears" inputMode="numeric" className={fieldClass} aria-invalid={!!errors.experienceYears} {...register('experienceYears')} />
                </Field>
                <Field id="languages" label="Languages you speak" hint="Separate with commas, for example English, Hindi." error={errors.languages?.message}>
                    <input id="languages" className={fieldClass} aria-invalid={!!errors.languages} {...register('languages')} />
                </Field>
                <Field id="bio" label="About you (optional)" hint="Up to 1000 characters." error={errors.bio?.message}>
                    <textarea id="bio" rows={4} className={fieldClass} aria-invalid={!!errors.bio} {...register('bio')} />
                </Field>
                <Field id="photoUrl" label="Photo web address (optional)" error={errors.photoUrl?.message}>
                    <input id="photoUrl" inputMode="url" className={fieldClass} placeholder="https://" aria-invalid={!!errors.photoUrl} {...register('photoUrl')} />
                </Field>
                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? 'Sending...' : existing ? 'Send again for review' : 'Send application'}
                </Button>
            </form>
        </Card>
    );
}
