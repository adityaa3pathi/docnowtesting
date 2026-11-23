/**
 * Doctor change requests (sheet row 22). A doctor's new weekly hours (with slot length) or profile text
 * (bio, languages, experience) waits for a super admin; patients keep seeing the live schedule and
 * profile until it is approved. Leave stays instant (emergencies) and only shows up for admins.
 *
 * - One pending request per doctor and kind. Sending again replaces it (the old one is SUPERSEDED), so
 *   an admin approves exactly the version on screen: approving a replaced one answers 409.
 * - Every write locks the doctor's row first, so a doctor's resend, two admins and a withdrawal are
 *   handled one at a time.
 * - Approval applies the change and rebuilds free slots in the same transaction. Booked slots are
 *   always kept, even when they fall outside the new hours.
 */
import { DoctorChangeKind, DoctorChangeRequest, Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { logger } from '../../utils/logger';
import { sendTemplateViaWhatsApp } from '../../services/wappieWhatsApp';
import { Tx } from './consultations.transitions';
import { DoctorError } from './doctors.status';
import { applyAvailability } from './doctors.service';
import { availabilitySchema, doctorTitle, SLOT_MINUTES } from './doctors.types';
import { assertNoOverlap, sortWindows, Window, withinHours } from './slots';
import { z } from 'zod';

export type AvailabilityChange = { windows: Window[]; slotMinutes: number };
export type ProfileChange = { bio?: string | null; languages?: string[]; experienceYears?: number };
export const PROFILE_CHANGE_FIELDS = ['bio', 'languages', 'experienceYears'] as const;
export type Reviewer = { adminId: string; adminName: string; ip?: string };

const storedAvailability = availabilitySchema.extend({
    slotMinutes: z.number().refine((n) => (SLOT_MINUTES as readonly number[]).includes(n)),
});
const storedProfile = z.object({
    bio: z.string().max(1000).nullable(),
    languages: z.array(z.string().min(2)).min(1),
    experienceYears: z.number().int().min(0).max(70),
}).partial();

/** What a doctor sees of their own requests: never the reviewing admin. */
export const doctorChangeSelect = {
    id: true, kind: true, status: true, payload: true, previous: true, reviewReason: true, createdAt: true, reviewedAt: true,
} as const;

async function lockDoctor(tx: Tx, doctorId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "DoctorProfile" WHERE id = ${doctorId} FOR UPDATE`;
    if (rows.length === 0) throw new DoctorError(404, 'Doctor not found');
}

async function liveAvailability(tx: Tx, doctorId: string): Promise<AvailabilityChange> {
    const [doctor, windows] = await Promise.all([
        tx.doctorProfile.findUniqueOrThrow({ where: { id: doctorId }, select: { slotMinutes: true } }),
        tx.doctorAvailability.findMany({ where: { doctorId } }),
    ]);
    return { windows: sortWindows(windows), slotMinutes: doctor.slotMinutes };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Saves `payload` as the one pending request of its kind, replacing any older one. */
async function replacePending(tx: Tx, doctorId: string, kind: DoctorChangeKind, payload: object, previous: object) {
    await tx.doctorChangeRequest.updateMany({ where: { doctorId, kind, status: 'PENDING' }, data: { status: 'SUPERSEDED' } });
    return tx.doctorChangeRequest.create({
        data: { doctorId, kind, payload: payload as Prisma.InputJsonValue, previous: previous as Prisma.InputJsonValue },
        select: doctorChangeSelect,
    });
}

async function withdrawPending(tx: Tx, doctorId: string, kind: DoctorChangeKind) {
    await tx.doctorChangeRequest.updateMany({ where: { doctorId, kind, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
}

/** Two tabs racing past the lock should not happen, but the partial unique index is the last word. */
function mapPendingRace(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new DoctorError(409, 'Another change was sent at the same moment. Reload and try again.');
    }
    throw e;
}

// ── Doctor ──────────────────────────────────────────────

/**
 * New weekly hours wait for approval. Sending the live hours back withdraws any pending change
 * (nothing is left to approve), and answers `request: null`.
 */
export async function submitAvailabilityChange(doctorId: string, input: { windows: Window[]; slotMinutes?: number }) {
    try {
        assertNoOverlap(input.windows);
    } catch (e: any) {
        throw new DoctorError(400, e.message);
    }
    try {
        return await prisma.$transaction(async (tx) => {
            await lockDoctor(tx, doctorId);
            const live = await liveAvailability(tx, doctorId);
            const payload: AvailabilityChange = { windows: sortWindows(input.windows), slotMinutes: input.slotMinutes ?? live.slotMinutes };
            if (sameJson(payload, live)) {
                await withdrawPending(tx, doctorId, 'AVAILABILITY');
                return { request: null };
            }
            return { request: await replacePending(tx, doctorId, 'AVAILABILITY', payload, live) };
        });
    } catch (e) {
        mapPendingRace(e);
    }
}

/** Only the fields that differ from the live profile go into the request. */
export async function submitProfileChange(doctorId: string, input: ProfileChange) {
    try {
        return await prisma.$transaction(async (tx) => {
            await lockDoctor(tx, doctorId);
            const live = await tx.doctorProfile.findUniqueOrThrow({ where: { id: doctorId }, select: { bio: true, languages: true, experienceYears: true } });
            const payload: ProfileChange = {};
            const previous: ProfileChange = {};
            for (const field of PROFILE_CHANGE_FIELDS) {
                if (input[field] === undefined) continue;
                const next = field === 'bio' ? (input.bio || null) : input[field];
                if (sameJson(next, live[field])) continue;
                (payload as Record<string, unknown>)[field] = next;
                (previous as Record<string, unknown>)[field] = live[field];
            }
            if (Object.keys(payload).length === 0) {
                await withdrawPending(tx, doctorId, 'PROFILE');
                return { request: null };
            }
            return { request: await replacePending(tx, doctorId, 'PROFILE', payload, previous) };
        });
    } catch (e) {
        mapPendingRace(e);
    }
}

export async function withdrawChange(doctorId: string, requestId: string) {
    await prisma.$transaction(async (tx) => {
        await lockDoctor(tx, doctorId);
        const res = await tx.doctorChangeRequest.updateMany({ where: { id: requestId, doctorId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
        if (res.count === 0) throw new DoctorError(409, 'This change is no longer waiting for approval');
    });
}

/**
 * The doctor's pending requests (always) plus their recent decided and withdrawn ones, newest first.
 * Withdrawn ones are there so an old rejection is not shown as the latest news after a take-back.
 */
export async function myChanges(doctorId: string) {
    const [pending, recent] = await Promise.all([
        prisma.doctorChangeRequest.findMany({ where: { doctorId, status: 'PENDING' }, select: doctorChangeSelect }),
        prisma.doctorChangeRequest.findMany({
            where: { doctorId, status: { in: ['APPROVED', 'REJECTED', 'WITHDRAWN'] } },
            select: doctorChangeSelect,
            orderBy: { createdAt: 'desc' },
            take: 10,
        }),
    ]);
    return [...pending, ...recent].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// ── Super admin ─────────────────────────────────────────

/** Future booked slots that fall outside `windows`. They stay booked; the admin should know. */
async function bookedOutside(db: Tx, doctorId: string, windows: Window[]) {
    const booked = await db.slot.findMany({
        where: { doctorId, status: 'BOOKED', startsAt: { gt: new Date() } },
        select: { startsAt: true, endsAt: true },
    });
    return booked.filter((s) => !withinHours(windows, s)).length;
}

export async function reviewChange(reviewer: Reviewer, requestId: string, decision: 'APPROVED' | 'REJECTED', reason?: string) {
    const outcome = await prisma.$transaction(async (tx) => {
        const found = await tx.doctorChangeRequest.findUnique({ where: { id: requestId }, select: { doctorId: true } });
        if (!found) throw new DoctorError(404, 'Change request not found');
        await lockDoctor(tx, found.doctorId);
        // Read again under the lock: another admin, or the doctor, may have just acted on it.
        const request = await tx.doctorChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
        if (request.status === 'SUPERSEDED') throw new DoctorError(409, 'The doctor has sent a newer version. Reload to review it.');
        if (request.status !== 'PENDING') throw new DoctorError(409, 'This change has already been handled. Reload to see it.');

        let keptOutside = 0;
        if (decision === 'APPROVED') keptOutside = await applyChange(tx, request);
        const updated = await tx.doctorChangeRequest.update({
            where: { id: requestId },
            data: { status: decision, reviewReason: reason ?? null, reviewedById: reviewer.adminId, reviewedAt: new Date() },
        });
        await tx.adminAuditLog.create({
            data: {
                adminId: reviewer.adminId,
                adminName: reviewer.adminName,
                action: `DOCTOR_CHANGE_${decision}`,
                entity: 'DoctorProfile',
                targetId: request.doctorId,
                oldValue: request.previous as Prisma.InputJsonValue,
                newValue: { requestId, kind: request.kind, payload: request.payload, reason: reason ?? null } as Prisma.InputJsonValue,
                ipAddress: reviewer.ip,
            },
        });
        return { request: updated, keptOutside };
    }, { timeout: 15_000 });
    void notifyDoctor(outcome.request).catch((e) => logger.warn({ err: String(e), requestId }, 'doctor_change_notice_failed'));
    return { id: outcome.request.id, status: outcome.request.status, bookedKeptOutsideHours: outcome.keptOutside };
}

/** Applies an approved request. Returns how many booked slots are kept outside the new hours. */
async function applyChange(tx: Tx, request: DoctorChangeRequest) {
    if (request.kind === 'AVAILABILITY') {
        const p = storedAvailability.parse(request.payload);
        await applyAvailability(tx, request.doctorId, p.windows, p.slotMinutes);
        return bookedOutside(tx, request.doctorId, p.windows);
    }
    const p = storedProfile.parse(request.payload);
    await tx.doctorProfile.update({ where: { id: request.doctorId }, data: p });
    return 0;
}

const RECENT_LEAVE_DAYS = 7;

/**
 * The review queue: requests of one status (oldest pending first) with the doctor's live values to
 * compare against, plus leave added in the last week, which takes effect at once but admins should see.
 */
export async function listChanges(status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING') {
    const requests = await prisma.doctorChangeRequest.findMany({
        where: { status },
        orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
        take: 100,
        include: {
            doctor: {
                select: {
                    id: true, displayName: true, photoUrl: true, status: true, slotMinutes: true, bio: true, languages: true, experienceYears: true,
                    specialty: { select: { name: true } }, availability: true,
                },
            },
        },
    });
    const items = await Promise.all(requests.map(async (r) => {
        const { doctor, reviewedById: _hidden, ...rest } = r;
        const { availability, slotMinutes, bio, languages, experienceYears, ...who } = doctor;
        const live = r.kind === 'AVAILABILITY'
            ? { windows: sortWindows(availability), slotMinutes }
            : { bio, languages, experienceYears };
        // One unreadable payload must not take the whole queue down.
        const hours = r.status === 'PENDING' && r.kind === 'AVAILABILITY' ? storedAvailability.safeParse(r.payload) : null;
        if (hours && !hours.success) logger.warn({ requestId: r.id }, 'doctor_change_payload_unreadable');
        const keptOutside = hours?.success ? await bookedOutside(prisma, doctor.id, hours.data.windows) : null;
        return { ...rest, doctor: who, live, bookedOutsideNewHours: keptOutside };
    }));

    const since = new Date(Date.now() - RECENT_LEAVE_DAYS * 86_400_000);
    const leaves = await prisma.doctorLeave.findMany({
        where: { createdAt: { gte: since }, endsAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { doctor: { select: { id: true, displayName: true } } },
    });
    const recentLeave = await Promise.all(leaves.map(async (l) => ({
        ...l,
        bookedInside: await prisma.slot.count({
            where: { doctorId: l.doctorId, status: 'BOOKED', AND: [{ startsAt: { lt: l.endsAt } }, { startsAt: { gt: new Date() } }], endsAt: { gt: l.startsAt } },
        }),
    })));
    return { requests: items, recentLeave };
}

// ── Doctor notice ───────────────────────────────────────

const KIND_TEXT: Record<DoctorChangeKind, string> = { AVAILABILITY: 'weekly hours', PROFILE: 'profile details' };

/**
 * WhatsApp to the doctor after a review. Off until the template is approved and set in
 * CONSULT_WA_TEMPLATE_DOCTOR_CHANGE: body {{1}} doctor, {{2}} what changed, {{3}} the decision.
 * The doctor panel shows the result either way.
 */
async function notifyDoctor(request: DoctorChangeRequest) {
    const template = process.env.CONSULT_WA_TEMPLATE_DOCTOR_CHANGE;
    if (!template || (request.status !== 'APPROVED' && request.status !== 'REJECTED')) return;
    const doctor = await prisma.doctorProfile.findUnique({
        where: { id: request.doctorId },
        select: { displayName: true, user: { select: { mobile: true } } },
    });
    if (!doctor?.user.mobile) return;
    const decision = request.status === 'APPROVED' ? 'approved' : `not approved. Reason: ${request.reviewReason ?? 'not given'}`;
    await sendTemplateViaWhatsApp(doctor.user.mobile, template, process.env.CONSULT_WA_LANGUAGE || 'en', [{
        type: 'body',
        parameters: [doctorTitle(doctor.displayName), KIND_TEXT[request.kind], decision].map((text) => ({ type: 'text' as const, text: text.replace(/\s+/g, ' ').slice(0, 300) })),
    }]);
}
