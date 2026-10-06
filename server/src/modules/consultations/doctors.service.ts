/**
 * Doctor Service
 *
 * Sign-up, admin-created profiles, approval, weekly hours, leave and slot generation.
 * Roles follow status: DOCTOR is granted on approval and removed on suspend or reject.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { expireHold, Tx } from './consultations.transitions';
import { assertDoctorTransition, DoctorError } from './doctors.status';
import { assertNoOverlap, computeSlots, Window } from './slots';

export const SLOT_HORIZON_DAYS = 14;

async function assertActiveSpecialty(specialtyId: string) {
    const s = await prisma.specialty.findUnique({ where: { id: specialtyId } });
    if (!s || !s.isActive) throw new DoctorError(400, 'Specialty not found');
}

function mapUniqueError(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new DoctorError(409, 'This registration number is already registered');
    }
    throw e;
}

// ── Sign-up and admin create ────────────────────────────

export async function registerDoctor(userId: string, data: {
    displayName: string; specialtyId: string; qualification: string; registrationNumber: string;
    registrationCouncil: string; experienceYears: number; languages: string[]; bio?: string; photoUrl?: string;
}) {
    await assertActiveSpecialty(data.specialtyId);
    if (await prisma.doctorProfile.findUnique({ where: { userId } })) {
        throw new DoctorError(409, 'You have already registered as a doctor');
    }
    try {
        // Fee is set by admin on approval; 0 keeps the profile unbookable until then.
        return await prisma.doctorProfile.create({ data: { ...data, userId, consultationFee: 0 } });
    } catch (e) {
        mapUniqueError(e);
    }
}

export async function adminCreateDoctor(adminId: string, data: {
    mobile: string; displayName: string; specialtyId: string; qualification: string; registrationNumber: string;
    registrationCouncil: string; experienceYears: number; languages: string[]; bio?: string; photoUrl?: string;
    consultationFee: number; slotMinutes: number;
}) {
    await assertActiveSpecialty(data.specialtyId);
    const { mobile, ...profile } = data;
    try {
        return await prisma.$transaction(async (tx) => {
            let user = await tx.user.findUnique({ where: { mobile }, include: { doctorProfile: true } });
            if (user?.doctorProfile) throw new DoctorError(409, 'This mobile number is already a doctor');
            if (user && user.role !== 'USER') throw new DoctorError(409, 'This account has a staff role and cannot be a doctor');
            if (!user) {
                user = await tx.user.create({ data: { mobile, name: profile.displayName, role: 'DOCTOR' }, include: { doctorProfile: true } });
            } else {
                await tx.user.update({ where: { id: user.id }, data: { role: 'DOCTOR' } });
            }
            return tx.doctorProfile.create({
                data: { ...profile, userId: user.id, status: 'APPROVED', createdByAdminId: adminId, reviewedById: adminId, reviewedAt: new Date() },
            });
        });
    } catch (e) {
        mapUniqueError(e);
    }
}

// ── Review ──────────────────────────────────────────────

export async function reviewDoctor(
    adminId: string,
    doctorId: string,
    to: 'APPROVED' | 'REJECTED' | 'SUSPENDED',
    reason?: string,
) {
    const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, include: { user: true } });
    if (!doctor) throw new DoctorError(404, 'Doctor not found');
    assertDoctorTransition(doctor.status, to);
    if (to === 'APPROVED' && doctor.consultationFee <= 0) {
        throw new DoctorError(400, 'Set a consultation fee before approving');
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.doctorProfile.update({
            where: { id: doctorId },
            data: { status: to, statusReason: to === 'APPROVED' ? null : reason, reviewedById: adminId, reviewedAt: new Date() },
        });
        if (to === 'APPROVED' && doctor.user.role === 'USER') {
            await tx.user.update({ where: { id: doctor.userId }, data: { role: 'DOCTOR' } });
        }
        if (to !== 'APPROVED') {
            // Unpaid holds go; paid consultations are left for staff.
            const holds = await tx.consultation.findMany({ where: { doctorId, status: 'PENDING_PAYMENT' }, select: { id: true } });
            for (const h of holds) await expireHold(tx, h.id);
        }
        if (to !== 'APPROVED' && doctor.user.role === 'DOCTOR') {
            await tx.user.update({ where: { id: doctor.userId }, data: { role: 'USER' } });
            await clearFreeSlots(tx, { doctorId });
        }
        if (to === 'APPROVED') await rebuildSlots(tx, doctorId);
        return updated;
    });
}

// ── Hours, leave, slots ─────────────────────────────────

/**
 * Removes free future slots. A slot an old consultation still points at cannot be deleted,
 * so it is blocked instead and never offered again.
 */
async function clearFreeSlots(tx: Tx, where: Prisma.SlotWhereInput) {
    const base: Prisma.SlotWhereInput = { status: 'AVAILABLE', AND: [{ startsAt: { gt: new Date() } }, where] };
    await tx.slot.deleteMany({ where: { ...base, consultations: { none: {} } } });
    await tx.slot.updateMany({ where: base, data: { status: 'BLOCKED' } });
}

async function wantedSlots(tx: Tx, doctorId: string) {
    const doctor = await tx.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const [windows, leaves] = await Promise.all([
        tx.doctorAvailability.findMany({ where: { doctorId } }),
        tx.doctorLeave.findMany({ where: { doctorId, endsAt: { gt: new Date() } } }),
    ]);
    return computeSlots({ windows, leaves, slotMinutes: doctor.slotMinutes, from: new Date(), days: SLOT_HORIZON_DAYS });
}

async function createMissingSlots(tx: Tx, doctorId: string, ranges: { startsAt: Date; endsAt: Date }[]) {
    if (ranges.length === 0) return 0;
    const res = await tx.slot.createMany({
        data: ranges.map((r) => ({ doctorId, startsAt: r.startsAt, endsAt: r.endsAt })),
        skipDuplicates: true,
    });
    return res.count;
}

async function ensureSlots(tx: Tx, doctorId: string) {
    return createMissingSlots(tx, doctorId, await wantedSlots(tx, doctorId));
}

/**
 * Brings free slots in line with the doctor's hours and leave. Slots still wanted are left alone;
 * blocked slots with booking history that are wanted again (after suspension or leave) are reopened.
 */
async function rebuildSlots(tx: Tx, doctorId: string) {
    const wanted = await wantedSlots(tx, doctorId);
    const starts = wanted.map((r) => r.startsAt);
    await clearFreeSlots(tx, { doctorId, startsAt: { notIn: starts } });
    await tx.slot.updateMany({
        where: { doctorId, status: 'BLOCKED', startsAt: { in: starts }, consultations: { some: {} } },
        data: { status: 'AVAILABLE' },
    });
    await createMissingSlots(tx, doctorId, wanted);
}

export async function setAvailability(doctorId: string, windows: Window[], slotMinutes?: number) {
    try {
        assertNoOverlap(windows);
    } catch (e: any) {
        throw new DoctorError(400, e.message);
    }
    return prisma.$transaction(async (tx) => {
        await tx.doctorAvailability.deleteMany({ where: { doctorId } });
        if (windows.length) await tx.doctorAvailability.createMany({ data: windows.map((w) => ({ ...w, doctorId })) });
        if (slotMinutes) await tx.doctorProfile.update({ where: { id: doctorId }, data: { slotMinutes } });
        await rebuildSlots(tx, doctorId);
        return tx.doctorAvailability.findMany({ where: { doctorId }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] });
    });
}

export async function addLeave(doctorId: string, startsAt: Date, endsAt: Date, reason?: string) {
    return prisma.$transaction(async (tx) => {
        const leave = await tx.doctorLeave.create({ data: { doctorId, startsAt, endsAt, reason } });
        await clearFreeSlots(tx, { doctorId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } });
        const bookedConflicts = await tx.slot.count({
            where: { doctorId, status: 'BOOKED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        });
        return { leave, bookedConflicts };
    });
}

export async function removeLeave(doctorId: string, leaveId: string) {
    await prisma.$transaction(async (tx) => {
        const res = await tx.doctorLeave.deleteMany({ where: { id: leaveId, doctorId } });
        if (res.count === 0) throw new DoctorError(404, 'Leave not found');
        await rebuildSlots(tx, doctorId);
    });
}

export async function setSlotBlocked(doctorId: string, slotId: string, blocked: boolean) {
    const res = await prisma.slot.updateMany({
        where: { id: slotId, doctorId, status: blocked ? 'AVAILABLE' : 'BLOCKED', startsAt: { gt: new Date() } },
        data: { status: blocked ? 'BLOCKED' : 'AVAILABLE' },
    });
    if (res.count === 0) throw new DoctorError(409, blocked ? 'Slot is not available to block' : 'Slot is not blocked');
}

/** Daily job: keep the rolling slot window full for every approved doctor. */
export async function extendAllDoctorSlots() {
    const doctors = await prisma.doctorProfile.findMany({ where: { status: 'APPROVED' }, select: { id: true } });
    let created = 0;
    for (const d of doctors) {
        created += await prisma.$transaction((tx) => ensureSlots(tx, d.id));
    }
    return { doctors: doctors.length, created };
}
