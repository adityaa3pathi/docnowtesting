/**
 * Assisted family consultations: who besides the booker may see and join one.
 *
 * The booker types the family member's phone on the Patient. Whoever signs in with that number
 * sees the consultation, but only its doctor and time until they accept once ("Aditya booked this
 * for you, is this you?"). Acceptance is stored on the Patient (linkedUserId), so it covers every
 * later booking for them too. A mistyped number therefore never reveals health details: its owner
 * sees a name and a time, and can decline, which hides the person's bookings from them for good.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logger } from '../../utils/logger';
import { DoctorError } from './doctors.status';

export type ConsultAccess =
    /** The account that booked and paid. `forFamily` when the visit is for someone else. */
    | { kind: 'booker'; forFamily: boolean }
    /** The family member, signed in with the patient's phone and accepted. */
    | { kind: 'family' }
    /** Same, before accepting: may see doctor and time only. */
    | { kind: 'family-pending' };

type Db = Pick<PrismaClient, 'user' | 'consultation' | 'patient'>;

export const isSelf = (relation: string) => relation.trim().toLowerCase() === 'self';

export async function userMobile(db: Pick<PrismaClient, 'user'>, userId: string): Promise<string | null> {
    const u = await db.user.findUnique({ where: { id: userId }, select: { mobile: true } });
    return u?.mobile ?? null;
}

/** Consultations booked by someone else for the person whose phone this user signs in with. */
export function familyWhere(userId: string, mobile: string): Prisma.ConsultationWhereInput {
    return {
        userId: { not: userId },
        patient: {
            phone: mobile,
            NOT: { relation: { equals: 'Self', mode: 'insensitive' } },
            linkDeclinedAt: null,
            OR: [{ linkedUserId: null }, { linkedUserId: userId }],
        },
    };
}

/** The rule itself, on rows already loaded. */
export function accessFor(
    c: { userId: string; patient: { relation: string; phone: string | null; linkedUserId: string | null; linkDeclinedAt: Date | null } },
    userId: string,
    mobile: string | null,
): ConsultAccess | null {
    if (c.userId === userId) return { kind: 'booker', forFamily: !isSelf(c.patient.relation) };
    const p = c.patient;
    if (!mobile || !p.phone || p.phone !== mobile || isSelf(p.relation) || p.linkDeclinedAt) return null;
    if (p.linkedUserId === userId) return { kind: 'family' };
    if (p.linkedUserId === null) return { kind: 'family-pending' };
    return null;
}

const accessSelect = {
    id: true, userId: true, patientId: true,
    patient: { select: { relation: true, phone: true, linkedUserId: true, linkDeclinedAt: true } },
} as const;

/** Loads one consultation with this user's access to it, or null (callers answer 404, never 403). */
export async function resolveAccess(userId: string, consultationId: string, db: Db = prisma) {
    const c = await db.consultation.findUnique({ where: { id: consultationId }, select: accessSelect });
    if (!c) return null;
    const access = accessFor(c, userId, c.userId === userId ? null : await userMobile(db, userId));
    return access ? { access, consultation: c } : null;
}

/** Read access to clinical details (dossier, prescription, tests): the booker or an accepted family member. */
export const canSeeClinical = (a: ConsultAccess) => a.kind === 'booker' || a.kind === 'family';

/** Accepts the link for one Patient: from now on this user sees all its consultations in full. */
export async function acceptFamilyLink(userId: string, patientId: string, db: Db = prisma, now = new Date()) {
    const mobile = await userMobile(db, userId);
    if (!mobile) throw new DoctorError(404, 'Not found');
    const res = await db.patient.updateMany({
        where: { id: patientId, phone: mobile, linkDeclinedAt: null, OR: [{ linkedUserId: null }, { linkedUserId: userId }] },
        data: { linkedUserId: userId, linkedAt: now },
    });
    if (res.count !== 1) throw new DoctorError(404, 'Not found');
    logger.info({ patientId, userId }, 'family_link_accepted');
    return { patientId, linked: true };
}

/** "This is not me": hides this person's consultations from this number and flags it for the booker. */
export async function declineFamilyLink(userId: string, patientId: string, db: Db = prisma, now = new Date()) {
    const mobile = await userMobile(db, userId);
    if (!mobile) throw new DoctorError(404, 'Not found');
    const res = await db.patient.updateMany({
        where: { id: patientId, phone: mobile, linkedUserId: null },
        data: { linkDeclinedAt: now },
    });
    if (res.count !== 1) throw new DoctorError(404, 'Not found');
    // The booker probably typed the wrong number; staff and the booking page can tell them.
    logger.warn({ patientId }, 'family_link_declined');
    return { patientId, linked: false };
}
