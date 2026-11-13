'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import { admin, errorMessage } from '@/lib/consult/api';
import { useApi } from '@/hooks/useApi';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { Field, SLOT_OPTIONS, inputCls } from './shared';

// Mirrors the server's adminCreateDoctorSchema.
const schema = z.object({
    mobile: z.string().regex(/^\d{10}$/, 'Enter the 10-digit mobile number'),
    displayName: z.string().trim().min(2, 'Enter the doctor’s name'),
    specialtyId: z.string().min(1, 'Pick a specialty'),
    qualification: z.string().trim().min(2, 'Enter the qualification'),
    registrationNumber: z.string().trim().min(3, 'Enter the registration number'),
    registrationCouncil: z.string().trim().min(2, 'Enter the registration council'),
    experienceYears: z.coerce.number().int('Whole years only').min(0, 'Cannot be negative').max(70, 'At most 70'),
    languages: z.string().refine((v) => v.split(',').some((l) => l.trim().length >= 2), 'Enter at least one language'),
    bio: z.string().trim().max(1000, 'At most 1000 characters').optional(),
    consultationFee: z.coerce.number().positive('Fee must be more than zero'),
    slotMinutes: z.coerce.number(),
});
type Values = z.input<typeof schema>;

export function DoctorForm() {
    const router = useRouter();
    const specialties = useApi(() => admin.specialties(), []);
    const [formError, setFormError] = useState<string | null>(null);
    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { mobile: '', displayName: '', specialtyId: '', qualification: '', registrationNumber: '', registrationCouncil: '', experienceYears: 0, languages: 'English', bio: '', consultationFee: '' as unknown as number, slotMinutes: 15 },
    });

    if (specialties.loading) return <LoadingBlock label="Loading specialties" />;
    if (specialties.error) return <ErrorState message={specialties.error} onRetry={specialties.refetch} />;
    const active = (specialties.data ?? []).filter((s) => s.isActive);

    async function onSubmit(raw: Values) {
        const v = schema.parse(raw);
        setFormError(null);
        try {
            const created = await admin.createDoctor({
                mobile: v.mobile, displayName: v.displayName, specialtyId: v.specialtyId, qualification: v.qualification,
                registrationNumber: v.registrationNumber, registrationCouncil: v.registrationCouncil, experienceYears: v.experienceYears,
                languages: v.languages.split(',').map((l) => l.trim()).filter((l) => l.length >= 2),
                bio: v.bio || undefined, consultationFee: v.consultationFee, slotMinutes: v.slotMinutes,
            });
            toast.success('Doctor created');
            router.push(`/super-admin/consult-doctors/${created.id}`);
        } catch (e) {
            setFormError(errorMessage(e));
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
            <div className="grid gap-5 md:grid-cols-2">
                <Field label="Mobile number" htmlFor="mobile" error={errors.mobile?.message} hint="The doctor signs in with this number.">
                    <input id="mobile" inputMode="numeric" maxLength={10} autoComplete="off" className={inputCls} {...register('mobile')} />
                </Field>
                <Field label="Name" htmlFor="displayName" error={errors.displayName?.message}>
                    <input id="displayName" className={inputCls} {...register('displayName')} />
                </Field>
                <Field label="Specialty" htmlFor="specialtyId" error={errors.specialtyId?.message}>
                    <select id="specialtyId" className={inputCls} {...register('specialtyId')}>
                        <option value="">Choose one</option>
                        {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </Field>
                <Field label="Qualification" htmlFor="qualification" error={errors.qualification?.message}>
                    <input id="qualification" className={inputCls} {...register('qualification')} />
                </Field>
                <Field label="Registration number" htmlFor="registrationNumber" error={errors.registrationNumber?.message}>
                    <input id="registrationNumber" className={inputCls} {...register('registrationNumber')} />
                </Field>
                <Field label="Registration council" htmlFor="registrationCouncil" error={errors.registrationCouncil?.message}>
                    <input id="registrationCouncil" className={inputCls} {...register('registrationCouncil')} />
                </Field>
                <Field label="Years of experience" htmlFor="experienceYears" error={errors.experienceYears?.message}>
                    <input id="experienceYears" type="number" min={0} max={70} className={inputCls} {...register('experienceYears')} />
                </Field>
                <Field label="Languages" htmlFor="languages" error={errors.languages?.message} hint="Separate with commas.">
                    <input id="languages" className={inputCls} {...register('languages')} />
                </Field>
                <Field label="Consultation fee (rupees)" htmlFor="consultationFee" error={errors.consultationFee?.message}>
                    <input id="consultationFee" type="number" min={1} step="any" className={inputCls} {...register('consultationFee')} />
                </Field>
                <Field label="Slot length" htmlFor="slotMinutes">
                    <select id="slotMinutes" className={inputCls} {...register('slotMinutes')}>
                        {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                    </select>
                </Field>
            </div>
            <Field label="About the doctor (optional)" htmlFor="bio" error={errors.bio?.message}>
                <textarea id="bio" rows={3} className={inputCls} {...register('bio')} />
            </Field>
            {formError && <p role="alert" className="text-sm font-semibold text-red-600">{formError}</p>}
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating...' : 'Create doctor'}</Button>
        </form>
    );
}
