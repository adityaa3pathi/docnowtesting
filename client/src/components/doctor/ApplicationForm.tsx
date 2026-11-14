'use client';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Card } from '@/components/ui';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { consult, doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import type { DoctorMe } from '@/lib/consult/types';
import { PHOTO_TYPES, shrinkPhoto } from '@/lib/consult/photo';

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
    gender: z.enum(['Male', 'Female', 'Other'], 'Choose your gender.'),
});
type FormValues = z.infer<typeof schema>;

const splitLanguages = (text: string) => text.split(',').map((l) => l.trim()).filter(Boolean);

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
    // The photo uploads after the profile exists; a doctor is approved only with one.
    const [photo, setPhoto] = useState<File | null>(null);
    const [photoError, setPhotoError] = useState<string | null>(null);
    const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
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
            gender: existing?.gender ?? undefined,
        },
    });

    const submit = handleSubmit(async (v) => {
        setFormError(null);
        if (!photo && !existing?.photoUrl) {
            setPhotoError('Add a photo of yourself.');
            return;
        }
        const body = {
            displayName: v.displayName,
            specialtyId: v.specialtyId,
            qualification: v.qualification,
            registrationNumber: v.registrationNumber,
            registrationCouncil: v.registrationCouncil,
            experienceYears: Number(v.experienceYears),
            languages: splitLanguages(v.languages),
            ...(v.bio ? { bio: v.bio } : {}),
            gender: v.gender,
        };
        let saved: DoctorMe;
        try {
            saved = existing ? await doctorApi.resubmit(body) : await doctorApi.register(body);
        } catch (e) {
            setFormError(errorMessage(e));
            return;
        }
        // A failed photo upload still lands on the status page, which offers the upload again.
        if (photo) {
            try {
                saved = { ...saved, photoUrl: (await doctorApi.uploadPhoto(await shrinkPhoto(photo))).photoUrl };
            } catch { /* the pending screen shows "Add your photo" */ }
        }
        onDone(saved);
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
                <Field id="gender" label="Gender" hint="Patients can filter doctors by gender." error={errors.gender?.message}>
                    <select id="gender" className={fieldClass} aria-invalid={!!errors.gender} {...register('gender')}>
                        <option value="">Choose</option>
                        <option value="Female">Female</option>
                        <option value="Male">Male</option>
                        <option value="Other">Other</option>
                    </select>
                </Field>
                <Field id="experienceYears" label="Years of experience" error={errors.experienceYears?.message}>
                    <input id="experienceYears" inputMode="numeric" className={fieldClass} aria-invalid={!!errors.experienceYears} {...register('experienceYears')} />
                </Field>
                <Field id="languages" label="Languages you speak" hint="Separate with commas, for example English, Hindi." error={errors.languages?.message}>
                    <input id="languages" className={fieldClass} aria-invalid={!!errors.languages} {...register('languages')} />
                </Field>
                <Field id="bio" label="About you (optional)" hint="Up to 1000 characters." error={errors.bio?.message}>
                    <textarea id="bio" rows={4} className={fieldClass} aria-invalid={!!errors.bio} {...register('bio')} />
                </Field>
                <Field id="photo" label="Your photo" hint="A clear, recent photo of your face. Patients see it when booking." error={photoError ?? undefined}>
                    <div className="flex items-center gap-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {(preview || existing?.photoUrl) && <img src={preview ?? existing!.photoUrl!} alt="" className="h-16 w-16 rounded-xl object-cover" />}
                        <input
                            id="photo"
                            type="file"
                            accept={PHOTO_TYPES.join(',')}
                            aria-invalid={!!photoError}
                            className="text-sm file:mr-3 file:h-11 file:rounded-lg file:border file:border-border-strong file:bg-surface file:px-4 file:font-medium"
                            onChange={(e) => {
                                const f = e.target.files?.[0] ?? null;
                                setPhotoError(f && !PHOTO_TYPES.includes(f.type) ? 'Choose a JPG, PNG or WebP photo.' : null);
                                setPhoto(f && PHOTO_TYPES.includes(f.type) ? f : null);
                            }}
                        />
                    </div>
                </Field>
                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? 'Sending...' : existing ? 'Send again for review' : 'Send application'}
                </Button>
            </form>
        </Card>
    );
}
