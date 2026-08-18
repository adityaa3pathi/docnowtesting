import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

export const ALLOWED_RELATIONS = ['Spouse', 'Child', 'Parent', 'Grand parent', 'Sibling', 'Friend', 'Native', 'Neighbour', 'Colleague', 'Others'] as const;

export const patientSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    relation: z.enum(ALLOWED_RELATIONS, { message: `Relation must be one of: ${ALLOWED_RELATIONS.join(', ')}` }),
    age: z.number().int().min(5, 'Family member must be at least 5 years old').max(150, 'Invalid age'),
    gender: z.enum(['Male', 'Female', 'Other'], { message: 'Gender must be Male, Female, or Other' }),
    dob: z.coerce.date().optional(),
});

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
