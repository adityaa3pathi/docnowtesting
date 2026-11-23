/**
 * Doctor Validation Schemas
 *
 * Zod schemas for doctor sign-up, admin doctor management, hours and leave.
 */
import { z } from 'zod';

export const DOCTOR_GENDERS = ['Male', 'Female', 'Other'] as const;

const mobile = z.string().regex(/^\d{10}$/, 'Valid 10-digit mobile number required');

const profileFields = {
    displayName: z.string().trim().min(2, 'Name is required'),
    specialtyId: z.string().uuid('Invalid specialty'),
    qualification: z.string().trim().min(2, 'Qualification is required'),
    registrationNumber: z.string().trim().min(3, 'Registration number is required'),
    registrationCouncil: z.string().trim().min(2, "Registration council is required"),
    experienceYears: z.number().int().min(0).max(70).default(0),
    languages: z.array(z.string().trim().min(2)).min(1, 'At least one language is required'),
    bio: z.string().trim().max(1000).optional(),
    gender: z.enum(DOCTOR_GENDERS).optional(),
};
// No photoUrl anywhere here: a photo arrives only as an uploaded file (POST /doctor/me/photo, or the
// admin create and photo routes), so approval's photo check always means a real stored photo.

export const SLOT_MINUTES = [10, 15, 20, 30, 45, 60] as const;

// Self sign-up must give gender (patients filter by it); admin-created profiles may add it later.
export const registerDoctorSchema = z.object({ ...profileFields, gender: z.enum(DOCTOR_GENDERS, 'Please choose your gender') });

export const adminCreateDoctorSchema = z.object({
    ...profileFields,
    mobile,
    consultationFee: z.number().positive('Fee must be positive'),
    slotMinutes: z.number().refine((n) => (SLOT_MINUTES as readonly number[]).includes(n), 'Invalid slot length').default(15),
});

export const adminUpdateDoctorSchema = z.object({
    ...profileFields,
    consultationFee: z.number().positive(),
    slotMinutes: z.number().refine((n) => (SLOT_MINUTES as readonly number[]).includes(n), 'Invalid slot length'),
}).partial();

export const doctorSelfUpdateSchema = z.object({
    bio: profileFields.bio,
    languages: profileFields.languages,
    experienceYears: profileFields.experienceYears,
    gender: profileFields.gender,
}).partial();

export const reviewReasonSchema = z.object({
    reason: z.string().trim().min(3, 'A reason is required'),
});

export const availabilitySchema = z.object({
    windows: z.array(z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(1).max(1440),
    }).refine((w) => w.endMinute > w.startMinute, 'End must be after start')).max(50),
    slotMinutes: z.number().refine((n) => (SLOT_MINUTES as readonly number[]).includes(n), 'Invalid slot length').optional(),
});

export const leaveSchema = z.object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    reason: z.string().trim().max(200).optional(),
}).refine((l) => new Date(l.endsAt) > new Date(l.startsAt), 'End must be after start');

export const specialtySchema = z.object({
    name: z.string().trim().min(2),
    description: z.string().trim().max(300).optional(),
    isActive: z.boolean().optional(),
});

/** "Dr. <name>", without doubling it when the name was saved with the title already. */
export const doctorTitle = (displayName: string) => {
    const name = displayName.trim();
    return /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
};
