/**
 * Doctor Service
 *
 * Sign-up, admin-created profiles, approval, weekly hours, leave and slot generation.
 * Roles follow status: DOCTOR is granted on approval and removed on suspend or reject.
 */
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../db';
import { expireHold, Tx } from './consultations.transitions';
import { assertDoctorTransition, DoctorError } from './doctors.status';
import { discardDoctorPhoto, doctorPhotoUrl, storeDoctorPhoto } from './doctors.photo';
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
    registrationCouncil: string; experienceYears: number; languages: string[]; bio?: string; gender?: string;
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

/** A rejected doctor fixes the application and sends it back for review. */
export async function resubmitDoctor(userId: string, data: {
    displayName: string; specialtyId: string; qualification: string; registrationNumber: string;
    registrationCouncil: string; experienceYears: number; languages: string[]; bio?: string; gender?: string;
}) {
    const current = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!current) throw new DoctorError(404, 'No doctor profile');
    if (current.status !== 'REJECTED') throw new DoctorError(409, 'Only a rejected application can be resubmitted');
    await assertActiveSpecialty(data.specialtyId);
    try {
        return await prisma.doctorProfile.update({
            where: { id: current.id },
            data: { ...data, status: 'PENDING', statusReason: null, reviewedById: null, reviewedAt: null },
        });
    } catch (e) {
        mapUniqueError(e);
    }
}

/**
 * An admin-created doctor is live at once, and patients choose doctors by face, so the photo
 * comes with the request. It is stored first and removed again if the doctor cannot be created.
 */
export async function adminCreateDoctor(adminId: string, data: {
    mobile: string; displayName: string; specialtyId: string; qualification: string; registrationNumber: string;
    registrationCouncil: string; experienceYears: number; languages: string[]; bio?: string; gender?: string;
    consultationFee: number; slotMinutes: number;
}, photo: Buffer, publicBase: string) {
    await assertActiveSpecialty(data.specialtyId);
    const { mobile, ...profile } = data;
    const photoKey = await storeDoctorPhoto(photo);
    const id = randomUUID();
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
                data: {
                    ...profile, id, photoKey, photoUrl: doctorPhotoUrl(publicBase, id),
                    userId: user.id, status: 'APPROVED', createdByAdminId: adminId, reviewedById: adminId, reviewedAt: new Date(),
                },
                include: { specialty: true, availability: true, user: { select: { mobile: true, email: true } } },
            });
        });
    } catch (e) {
        discardDoctorPhoto(photoKey);
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
    // Patients choose doctors by face, so no doctor goes live (or back live) without a photo.
    if (to === 'APPROVED' && !doctor.photoUrl) {
        throw new DoctorError(400, "Add the doctor's photo before approving");
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.doctorProfile.update({
            where: { id: doctorId },
            data: { status: to, statusReason: to === 'APPROVED' ? null : reason, reviewedById: adminId, reviewedAt: new Date() },
            include: { specialty: true, availability: true, user: { select: { mobile: true, email: true } } },
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

type Range = { startsAt: Date; endsAt: Date };
const overlaps = (a: Range, b: Range) => a.startsAt < b.endsAt && a.endsAt > b.startsAt;
const rangeKey = (r: Range) => `${r.startsAt.getTime()}/${r.endsAt.getTime()}`;

/** Future slots that are on offer or taken. A new or reopened slot must never overlap one of them. */
function liveSlots(tx: Tx, doctorId: string, exceptId?: string) {
    return tx.slot.findMany({
        where: { doctorId, status: { in: ['AVAILABLE', 'BOOKED'] }, endsAt: { gt: new Date() }, id: exceptId ? { not: exceptId } : undefined },
        select: { startsAt: true, endsAt: true },
    });
}

/**
 * The slots the doctor's hours and leave call for, leaving out any that overlap a booked slot: after a
 * slot-length change a booked slot keeps its old length.
 */
async function wantedSlots(tx: Tx, doctorId: string) {
    const now = new Date();
    const doctor = await tx.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const [windows, leaves, booked] = await Promise.all([
        tx.doctorAvailability.findMany({ where: { doctorId } }),
        tx.doctorLeave.findMany({ where: { doctorId, endsAt: { gt: now } } }),
        tx.slot.findMany({ where: { doctorId, status: 'BOOKED', endsAt: { gt: now } }, select: { startsAt: true, endsAt: true } }),
    ]);
    const ranges = computeSlots({ windows, leaves, slotMinutes: doctor.slotMinutes, from: now, days: SLOT_HORIZON_DAYS });
    return ranges.filter((r) => !booked.some((b) => overlaps(r, b)));
}

/**
 * Creates the wanted slots that do not exist yet. One is skipped if it overlaps a live slot that starts
 * at another time: an old-length slot freed again (an expired hold, a cancellation) is still on offer,
 * and a new slot across it would give the doctor two patients at once. Rebuilds clear such slots.
 */
async function createMissingSlots(tx: Tx, doctorId: string, ranges: Range[]) {
    if (ranges.length === 0) return 0;
    const live = await liveSlots(tx, doctorId);
    const fits = ranges.filter((r) => !live.some((s) => s.startsAt.getTime() !== r.startsAt.getTime() && overlaps(r, s)));
    if (fits.length === 0) return 0;
    const res = await tx.slot.createMany({
        data: fits.map((r) => ({ doctorId, startsAt: r.startsAt, endsAt: r.endsAt })),
        skipDuplicates: true,
    });
    return res.count;
}

async function ensureSlots(tx: Tx, doctorId: string) {
    return createMissingSlots(tx, doctorId, await wantedSlots(tx, doctorId));
}

/**
 * Brings free slots in line with the doctor's hours and leave. Booked slots are never touched.
 * - A free slot is kept only if a wanted slot has exactly its start and end, so a slot-length change
 *   replaces old-length slots instead of leaving them on offer.
 * - A slot with booking history cannot be deleted, and its start is unique. If a wanted slot starts at
 *   the same time with another length, the old row is resized to it (otherwise that time could never
 *   be offered again); the old consultation keeps its own start time. If not, it is blocked.
 * - Blocked slots with booking history that are wanted again (after suspension or leave) are reopened.
 */
async function rebuildSlots(tx: Tx, doctorId: string) {
    const now = new Date();
    const wanted = await wantedSlots(tx, doctorId);
    const keys = new Set(wanted.map(rangeKey));
    const byStart = new Map(wanted.map((r) => [r.startsAt.getTime(), r]));
    const [free, blockedWithHistory] = await Promise.all([
        tx.slot.findMany({
            where: { doctorId, status: 'AVAILABLE', startsAt: { gt: now } },
            select: { id: true, startsAt: true, endsAt: true, _count: { select: { consultations: true } } },
        }),
        tx.slot.findMany({
            where: { doctorId, status: 'BLOCKED', startsAt: { gt: now }, consultations: { some: {} } },
            select: { id: true, startsAt: true, endsAt: true },
        }),
    ]);
    const offGrid = free.filter((s) => !keys.has(rangeKey(s)));
    const resize = [
        ...offGrid.filter((s) => s._count.consultations > 0 && byStart.has(s.startsAt.getTime())),
        ...blockedWithHistory.filter((s) => !keys.has(rangeKey(s)) && byStart.has(s.startsAt.getTime())),
    ];
    const resizeIds = new Set(resize.map((s) => s.id));
    const stale = offGrid.filter((s) => !resizeIds.has(s.id)).map((s) => s.id);
    if (stale.length) await clearFreeSlots(tx, { id: { in: stale } });
    // Park the rows to resize first, so the overlap check below sees only slots that stay live.
    if (resize.length) await tx.slot.updateMany({ where: { id: { in: [...resizeIds] } }, data: { status: 'BLOCKED' } });

    const live = await liveSlots(tx, doctorId);
    const reopen = (r: Range) => !live.some((s) => s.startsAt.getTime() !== r.startsAt.getTime() && overlaps(r, s));
    for (const s of resize) {
        const target = byStart.get(s.startsAt.getTime())!;
        if (!reopen(target)) continue;
        await tx.slot.update({ where: { id: s.id }, data: { endsAt: target.endsAt, status: 'AVAILABLE' } });
        live.push(target);
    }
    const exact = blockedWithHistory.filter((s) => keys.has(rangeKey(s)) && reopen(s)).map((s) => s.id);
    if (exact.length) await tx.slot.updateMany({ where: { id: { in: exact } }, data: { status: 'AVAILABLE' } });
    await createMissingSlots(tx, doctorId, wanted);
}

/**
 * Replaces the doctor's weekly hours (and slot length) and rebuilds free slots. Slots are rebuilt only
 * for an approved doctor; approval rebuilds them for anyone else. Doctors do not call this directly:
 * their changes wait for a super admin (doctors.changes.ts).
 */
export async function applyAvailability(tx: Tx, doctorId: string, windows: Window[], slotMinutes?: number) {
    try {
        assertNoOverlap(windows);
    } catch (e: any) {
        throw new DoctorError(400, e.message);
    }
    await tx.doctorAvailability.deleteMany({ where: { doctorId } });
    if (windows.length) await tx.doctorAvailability.createMany({ data: windows.map((w) => ({ ...w, doctorId })) });
    const doctor = slotMinutes
        ? await tx.doctorProfile.update({ where: { id: doctorId }, data: { slotMinutes }, select: { status: true } })
        : await tx.doctorProfile.findUniqueOrThrow({ where: { id: doctorId }, select: { status: true } });
    if (doctor.status === 'APPROVED') await rebuildSlots(tx, doctorId);
    return tx.doctorAvailability.findMany({ where: { doctorId }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] });
}

/** An admin's direct edit. A new slot length rebuilds free slots at once, so old- and new-length slots never mix. */
export async function adminUpdateDoctor(doctorId: string, data: Prisma.DoctorProfileUpdateInput & { slotMinutes?: number }) {
    return prisma.$transaction(async (tx) => {
        const before = await tx.doctorProfile.findUnique({ where: { id: doctorId }, select: { slotMinutes: true } });
        if (!before) throw new DoctorError(404, 'Doctor not found');
        const updated = await tx.doctorProfile.update({
            where: { id: doctorId },
            data,
            include: { specialty: true, availability: true, user: { select: { mobile: true, email: true } } },
        });
        if (data.slotMinutes !== undefined && data.slotMinutes !== before.slotMinutes && updated.status === 'APPROVED') {
            await rebuildSlots(tx, doctorId);
        }
        return updated;
    });
}

export async function setAvailability(doctorId: string, windows: Window[], slotMinutes?: number) {
    return prisma.$transaction((tx) => applyAvailability(tx, doctorId, windows, slotMinutes));
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
    await prisma.$transaction(async (tx) => {
        if (!blocked) {
            // An old-length slot from before a slot-length change would overlap the new ones.
            const slot = await tx.slot.findFirst({ where: { id: slotId, doctorId }, select: { startsAt: true, endsAt: true } });
            if (slot && (await liveSlots(tx, doctorId, slotId)).some((s) => overlaps(s, slot))) {
                throw new DoctorError(409, 'This time overlaps another appointment slot, so it cannot be reopened');
            }
        }
        const res = await tx.slot.updateMany({
            where: { id: slotId, doctorId, status: blocked ? 'AVAILABLE' : 'BLOCKED', startsAt: { gt: new Date() } },
            data: { status: blocked ? 'BLOCKED' : 'AVAILABLE' },
        });
        if (res.count === 0) throw new DoctorError(409, blocked ? 'Slot is not available to block' : 'Slot is not blocked');
    });
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
