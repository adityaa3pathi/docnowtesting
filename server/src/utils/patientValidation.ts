import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

export const ALLOWED_RELATIONS = ['Spouse', 'Child', 'Parent', 'Grand parent', 'Sibling', 'Friend', 'Native', 'Neighbour', 'Colleague', 'Others'] as const;

export const patientSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    relation: z.enum(ALLOWED_RELATIONS, { message: `Relation must be one of: ${ALLOWED_RELATIONS.join(', ')}` }),
    age: z.number().int().min(5, 'Family member must be at least 5 years old').max(150, 'Invalid age'),
    gender: z.enum(['Male', 'Female', 'Other'], { message: 'Gender must be Male, Female, or Other' }),
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
        if (!user || !user.name || !user.gender || !user.age) {
            throw new Error('User profile is incomplete. Cannot create Self patient stub.');
        }

        selfPatient = await prisma.patient.create({
            data: {
                userId,
                name: user.name,
                relation: 'Self',
                gender: user.gender,
                age: user.age
            }
        });
    }

    return selfPatient;
}
