import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

export const ALLOWED_RELATIONS = ['Spouse', 'Child', 'Parent', 'Grand parent', 'Sibling', 'Friend', 'Native', 'Neighbour', 'Colleague', 'Others'] as const;

/** +91 98765 43210, 098765 43210 or 9876543210 → 9876543210. Null when it is not an Indian mobile. */
export function normalizeIndianMobile(input: string): string | null {
    let digits = input.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export const PREFERRED_LANGUAGES = ['hi', 'en'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

const tagList = (label: string) =>
    z.array(z.string().trim().min(1).max(80, `${label} entries must be under 80 characters`)).max(20, `Add at most 20 ${label.toLowerCase()}`)
        .transform((list) => [...new Set(list)]);

/** The family member's own phone and health snapshot, captured by the family intake form. */
export const patientHealthSchema = z.object({
    phone: z.union([
        z.literal('').transform(() => null),
        z.null(),
        z.string().transform((v, ctx) => {
            const phone = normalizeIndianMobile(v);
            if (!phone) ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
            return phone ?? z.NEVER;
        }),
    ]).optional(),
    preferredLanguage: z.enum(PREFERRED_LANGUAGES, { message: 'Language must be hi or en' }).optional(),
    bloodGroup: z.enum(BLOOD_GROUPS, { message: 'Unknown blood group' }).nullable().optional(),
    allergies: tagList('Allergies').optional(),
    chronicConditions: tagList('Conditions').optional(),
    currentMedications: tagList('Medicines').optional(),
});

export const patientSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    relation: z.enum(ALLOWED_RELATIONS, { message: `Relation must be one of: ${ALLOWED_RELATIONS.join(', ')}` }),
    age: z.number().int().min(5, 'Family member must be at least 5 years old').max(150, 'Invalid age'),
    gender: z.enum(['Male', 'Female', 'Other'], { message: 'Gender must be Male, Female, or Other' }),
    dob: z.coerce.date().optional(),
}).merge(patientHealthSchema);

/**
 * A changed phone points at a different person, so the family link (and any decline) starts over.
 * Spread into the update data.
 */
export function relinkFields(current: { phone: string | null }, next: { phone?: string | null }) {
    if (next.phone === undefined || next.phone === current.phone) return {};
    return { linkedUserId: null, linkedAt: null, linkDeclinedAt: null };
}

/**
 * Ensures a 'Self' patient stub exists for the user, drawing from the User record.
 * This is excluded from public patient CRUD arrays as Healthians billing requires it
 * but we don't want users "editing" their Self patient through the family UI.
 */
export async function resolveOrCreateSelfPatient(userId: string, prisma: PrismaClient) {
    let selfPatient = await prisma.patient.findFirst({
        where: { userId, relation: 'Self' }
    });

    if (!selfPatient) {
        // Fallback: create the Self stub from the User's core info
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new Error('User not found. Cannot create Self patient stub.');
        }

        // Use available profile data, falling back to sensible defaults
        // for users who signed up via OTP but haven't completed their profile
        const name = user.name || user.mobile || 'Self';
        const gender = user.gender || 'Other';
        const age = user.age || 25;

        selfPatient = await prisma.patient.create({
            data: {
                userId,
                name,
                relation: 'Self',
                gender,
                age,
                dob: user.dob || undefined,
            }
        });
    }

    return selfPatient;
}
