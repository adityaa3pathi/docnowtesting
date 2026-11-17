/**
 * What a patient can do when their doctor is late: move to another time with the same doctor, or
 * to the next free doctor of the same specialty, both without paying again. Only offered once the
 * server agrees the doctor is late (isDoctorLate). The full-refund option lives in cancellation.
 *
 * A move books the new slot, frees the old one and repoints the consultation in one transaction,
 * with conditional updates, so two patients can never end up on one slot.
 */
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { getBooking } from './consultations.booking';
import { toPaise } from './consultations.money';
import { DEFAULT_RULES, type Rules } from './consultations.policy';
import { isDoctorLate } from './consultations.room';
import { holdSlot, releaseSlot } from './consultations.transitions';
import { DoctorError } from './doctors.status';

type Deps = { db?: PrismaClient; now?: () => Date };

/** The next free doctor must be able to start within this long. */
export const REASSIGN_WINDOW_MS = 60 * 60_000;
/** A slot that began a few minutes ago is still usable: the doctor is on duty and free. */
export const REASSIGN_GRACE_MS = 5 * 60_000;
/** Messages tied to the old time; deleted on a move so they go out again for the new one. */
const TIME_BOUND_NOTICES = ['CONFIRMED', 'REMINDER', 'JOIN_NOW', 'PARTNER_WAITING'];

export const NOT_LATE = 'This option opens once your doctor is more than 5 minutes late';
export const SLOT_GONE = 'That time was just taken. Please pick another.';

const bookingSelect = {
    id: true, status: true, startsAt: true, doctorJoinedAt: true, doctorId: true, slotId: true, feePaise: true, policySnapshot: true,
    doctor: { select: { specialtyId: true } },
} as const;
type LateBooking = {
    id: string; status: import('./consultations.types').ConsultationStatus; startsAt: Date; doctorJoinedAt: Date | null;
    doctorId: string; slotId: string; feePaise: number; policySnapshot: unknown; doctor: { specialtyId: string };
};

async function lateBooking(db: PrismaClient, userId: string, consultationId: string, now: Date): Promise<LateBooking> {
    const c = await db.consultation.findFirst({ where: { id: consultationId, userId }, select: bookingSelect });
    if (!c) throw new DoctorError(404, 'Not found');
    if (!isDoctorLate(c, now)) throw new DoctorError(409, NOT_LATE);
    return c;
}

const minLeadMs = (c: { policySnapshot: unknown }) => ({ ...DEFAULT_RULES, ...(c.policySnapshot as Partial<Rules>) }).minLeadMinutes * 60_000;

/** Moves the consultation onto `slot` (and its doctor). Throws 409 if the slot or the booking changed meanwhile. */
async function moveBooking(db: PrismaClient, c: LateBooking, slot: { id: string; doctorId: string; startsAt: Date }) {
    await db.$transaction(async (tx) => {
        if (!(await holdSlot(tx, slot.id))) throw new DoctorError(409, SLOT_GONE);
        const moved = await tx.consultation.updateMany({
            // The doctor may join in the same instant; then the patient keeps their consultation.
            where: { id: c.id, slotId: c.slotId, status: { in: ['CONFIRMED', 'WAITING'] }, doctorJoinedAt: null },
            data: {
                doctorId: slot.doctorId,
                slotId: slot.id,
                startsAt: slot.startsAt,
                status: 'CONFIRMED',
                patientJoinedAt: null,
                startedAt: null,
                roomId: null,
            },
        });
        if (moved.count !== 1) throw new DoctorError(409, 'Your consultation changed meanwhile. Your doctor may have just joined; please refresh.');
        await releaseSlot(tx, c.slotId);
        await tx.consultationNotification.deleteMany({ where: { consultationId: c.id, kind: { in: TIME_BOUND_NOTICES } } });
    });
}

/** The same doctor's free times far enough ahead to book. */
export async function rescheduleSlots(userId: string, consultationId: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    const c = await lateBooking(db, userId, consultationId, now);
    return db.slot.findMany({
        where: { doctorId: c.doctorId, status: 'AVAILABLE', startsAt: { gt: new Date(now.getTime() + minLeadMs(c)) }, doctor: { status: 'APPROVED' } },
        select: { id: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: 'asc' },
        take: 60,
    });
}

export async function rescheduleBooking(userId: string, consultationId: string, newSlotId: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    const c = await lateBooking(db, userId, consultationId, now);
    const slot = await db.slot.findUnique({ where: { id: newSlotId }, select: { id: true, doctorId: true, startsAt: true, status: true } });
    if (!slot || slot.doctorId !== c.doctorId) throw new DoctorError(404, 'Slot not available');
    if (slot.startsAt.getTime() <= now.getTime() + minLeadMs(c)) throw new DoctorError(400, 'This time starts too soon. Please pick a later one.');
    if (slot.status !== 'AVAILABLE') throw new DoctorError(409, SLOT_GONE);

    await moveBooking(db, c, slot);
    logAlert('consult_doctor_late', { consultationId: c.id, doctorId: c.doctorId, outcome: 'rescheduled' });
    return getBooking(userId, c.id, db);
}

/** Who would take over now: the earliest free slot of another approved doctor, same specialty, no higher fee. */
async function nextDoctorSlot(db: PrismaClient, c: LateBooking, now: Date, slotId?: string) {
    return db.slot.findFirst({
        where: {
            ...(slotId ? { id: slotId } : {}),
            status: 'AVAILABLE',
            doctorId: { not: c.doctorId },
            startsAt: { gte: new Date(now.getTime() - REASSIGN_GRACE_MS), lte: new Date(now.getTime() + REASSIGN_WINDOW_MS) },
            doctor: { status: 'APPROVED', specialtyId: c.doctor.specialtyId, consultationFee: { lte: c.feePaise / 100 } },
        },
        orderBy: { startsAt: 'asc' },
        select: {
            id: true, doctorId: true, startsAt: true, endsAt: true,
            doctor: {
                select: {
                    id: true, displayName: true, photoUrl: true, qualification: true, experienceYears: true, languages: true,
                    consultationFee: true, specialty: { select: { name: true } },
                },
            },
        },
    });
}

export async function reassignOption(userId: string, consultationId: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    const c = await lateBooking(db, userId, consultationId, now);
    const s = await nextDoctorSlot(db, c, now);
    if (!s) return null;
    const { doctor, ...slot } = s;
    return { slot: { id: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt }, doctor: { ...doctor, specialty: doctor.specialty.name } };
}

export async function reassignBooking(userId: string, consultationId: string, slotId: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    const c = await lateBooking(db, userId, consultationId, now);
    // Re-checked against the same rules, so a stale or hand-picked slot cannot get through.
    const s = await nextDoctorSlot(db, c, now, slotId);
    if (!s) throw new DoctorError(409, 'That doctor is no longer available. Please check again.');
    if (toPaise(s.doctor.consultationFee) > c.feePaise) throw new DoctorError(409, 'That doctor is no longer available. Please check again.');

    await moveBooking(db, c, s);
    logAlert('consult_doctor_late', { consultationId: c.id, doctorId: c.doctorId, outcome: 'reassigned', newDoctorId: s.doctorId });
    return getBooking(userId, c.id, db);
}
