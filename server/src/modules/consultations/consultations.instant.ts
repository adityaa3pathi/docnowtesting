/**
 * "Consult a Doc now" (P10). General Physicians switch themselves online; a patient asks for a doctor
 * now and free GPs are rung one at a time, oldest request first. Nothing is charged until a doctor
 * accepts (Aditya, 2026-11-24: connect first, then pay). The accept makes a blocked slot starting
 * now; paying for it (createBooking with instantRequestId) turns it into an ordinary consultation,
 * so the room, notes, prescription, refunds and no-show code all run unchanged.
 *
 * The matcher (advanceInstant) runs every few seconds and on every patient poll and doctor
 * check-in. Every step is a conditional update, so several runs at once never double anything, and
 * partial unique indexes (see the migration) keep one ring per doctor and one live request per account.
 */
import { Prisma, PrismaClient, type InstantRequest } from '@prisma/client';
import { prisma } from '../../db';
import { deliverPush, pushDisabled, sendViaExpo, type ExpoSend, type PushChannelId } from '../../services/expoPush';
import { logger } from '../../utils/logger';
import { toPaise } from './consultations.money';
import { getActivePolicy } from './consultations.policy.service';
import type { Rules } from './consultations.policy';
import { expireHold, type Tx } from './consultations.transitions';
import { doctorTitle } from './doctors.types';
import { DoctorError } from './doctors.status';

/** The rules decided for instant consults (Aditya, 2026-11-24; owner to confirm). */
export const INSTANT = {
    /** A doctor has this long to accept a ring before the next one is asked. */
    ringMs: 60_000,
    /** A patient waits at most this long for a doctor; then the search stops, nothing charged. */
    searchMs: 10 * 60_000,
    /** After an accept, the patient pays within this. */
    payMs: 3 * 60_000,
    /** A payment that started just before payBy gets this long to land before the doctor is freed. */
    payGraceMs: 60_000,
    /** Paid but the doctor never joins: full refund after this (scheduled consults wait 10). */
    doctorWaitMinutes: 5,
    /** Rings in a row left unanswered before the doctor is switched offline. */
    missedRingsLimit: 2,
    /** A doctor whose panel has not checked in for this long is offline. */
    presenceTimeoutMs: 60_000,
    /** Check-ins come every few seconds; lastSeenAt is written at most this often. */
    checkInWriteMs: 15_000,
    /** Not rung when a booked consultation starts within their slot length plus this. */
    scheduledBufferMs: 5 * 60_000,
    reasonMin: 3,
    reasonMax: 200,
} as const;

/** Instant consults go to this specialty only (Aditya, 2026-11-24: GP only). */
export const instantSpecialtySlug = () => process.env.INSTANT_SPECIALTY_SLUG || 'general-physician';

export const NO_DOCTORS_ONLINE = 'No Doc is online right now. Please book a time instead';
export const REQUEST_MOVED = 'This request has moved to another doctor';
export const INSTANT_ENDED = 'This request has ended. Please start a new one';
export const ALREADY_PAID = 'You have already paid. Cancel from the booking page for a full refund before the doctor joins';
const LIVE: InstantRequest['status'][] = ['SEARCHING', 'RINGING', 'ACCEPTED'];

type Db = PrismaClient;
export type InstantDeps = { db?: Db; now?: Date; send?: ExpoSend };

/**
 * The rules an instant booking is held to, saved as its policy snapshot: a full refund on any cancel
 * (cancelling is only possible until the doctor joins), a shorter doctor wait, no rescheduling.
 */
export function instantRules(rules: Rules): Rules {
    return {
        ...rules,
        refundTiers: [{ minHoursBefore: 0, percent: 100 }],
        doctorNoShowWaitMinutes: INSTANT.doctorWaitMinutes,
        holdMinutes: INSTANT.payMs / 60_000,
        maxReschedules: 0,
    };
}

export function cleanInstantReason(raw: unknown): string {
    const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (text.length < INSTANT.reasonMin) throw new DoctorError(400, 'Tell the doctor briefly what is wrong');
    if (text.length > INSTANT.reasonMax) throw new DoctorError(400, `Keep it under ${INSTANT.reasonMax} characters`);
    if (/[\u0000-\u001f\u007f]/.test(text)) throw new DoctorError(400, 'Use plain text only');
    return text;
}

// ── Doctor presence ──────────────────────────────────────

/** Ends presences whose panel stopped checking in. The end is the last check-in, so payroll hours are not padded. */
export async function closeStalePresences(db: Db, now: Date) {
    // Through Prisma, not raw SQL: a raw timestamp parameter is compared in the database's time zone.
    const cutoff = new Date(now.getTime() - INSTANT.presenceTimeoutMs);
    const stale = await db.doctorPresence.findMany({ where: { endedAt: null, lastSeenAt: { lt: cutoff } }, select: { id: true, lastSeenAt: true } });
    for (const p of stale) {
        await db.doctorPresence.updateMany({ where: { id: p.id, endedAt: null, lastSeenAt: p.lastSeenAt }, data: { endedAt: p.lastSeenAt, endReason: 'TIMEOUT' } });
    }
    return stale.length;
}

async function instantDoctor(db: Db, doctorId: string) {
    const d = await db.doctorProfile.findUnique({
        where: { id: doctorId },
        select: { id: true, status: true, userId: true, displayName: true, slotMinutes: true, specialty: { select: { slug: true } } },
    });
    if (!d) throw new DoctorError(404, 'Not found');
    return d;
}

const takesInstant = (d: { status: string; specialty: { slug: string } }) => d.status === 'APPROVED' && d.specialty.slug === instantSpecialtySlug();

/** Gives a ring back to the queue: the request searches again (or ends, past its time) and this doctor is not asked again. */
async function handBack(tx: Tx | Db, requestId: string, doctorId: string, now: Date, onlyExpired: boolean) {
    const r = await tx.instantRequest.findUnique({ where: { id: requestId }, select: { searchEndsAt: true } });
    if (!r) return false;
    const over = r.searchEndsAt <= now;
    const res = await tx.instantRequest.updateMany({
        where: { id: requestId, status: 'RINGING', doctorId, ...(onlyExpired ? { ringExpiresAt: { lte: now } } : {}) },
        data: {
            status: over ? 'NO_MATCH' : 'SEARCHING',
            doctorId: null,
            ringExpiresAt: null,
            triedDoctorIds: { push: doctorId },
            ...(over ? { endedAt: now } : {}),
        },
    });
    return res.count === 1;
}

export async function goOnline(doctorId: string, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const d = await instantDoctor(db, doctorId);
    if (d.status !== 'APPROVED') throw new DoctorError(403, 'Only approved doctors can take instant consults');
    if (!takesInstant(d)) throw new DoctorError(403, 'Instant consults are for General Physicians only');
    await closeStalePresences(db, now);
    try {
        await db.doctorPresence.create({ data: { doctorId, startedAt: now, lastSeenAt: now } });
    } catch (e) {
        // Already online (another tab): that period simply goes on.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        await db.doctorPresence.updateMany({ where: { doctorId, endedAt: null }, data: { lastSeenAt: now } });
    }
    if (!deps.now) void kickInstant({ db });
    return doctorInstantState(doctorId, { db, now });
}

export async function goOffline(doctorId: string, deps: InstantDeps & { reason?: string } = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    await db.doctorPresence.updateMany({ where: { doctorId, endedAt: null }, data: { endedAt: now, endReason: deps.reason ?? 'OFF' } });
    // A ring left on screen goes to the next doctor at once. An accepted request stays: the patient is paying.
    const ringing = await db.instantRequest.findFirst({ where: { doctorId, status: 'RINGING' }, select: { id: true } });
    if (ringing) await handBack(db, ringing.id, doctorId, now, false);
    if (!deps.now) void kickInstant({ db });
    return doctorInstantState(doctorId, { db, now });
}

/** The panel's check-in, every few seconds while it is open and online. */
export async function doctorCheckIn(doctorId: string, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    await db.doctorPresence.updateMany({
        where: {
            doctorId,
            endedAt: null,
            lastSeenAt: { gte: new Date(now.getTime() - INSTANT.presenceTimeoutMs), lt: new Date(now.getTime() - INSTANT.checkInWriteMs) },
        },
        data: { lastSeenAt: now },
    });
    await advanceSafely({ db, now, send: deps.send, throttle: !deps.now });
    return doctorInstantState(doctorId, { db, now });
}

/** What the doctor panel shows: online or not (and why it went off), and any ring or accepted request. */
export async function doctorInstantState(doctorId: string, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const d = await instantDoctor(db, doctorId);
    const [presence, last, live, inConsult] = await Promise.all([
        db.doctorPresence.findFirst({ where: { doctorId, endedAt: null, lastSeenAt: { gte: new Date(now.getTime() - INSTANT.presenceTimeoutMs) } } }),
        db.doctorPresence.findFirst({ where: { doctorId, endedAt: { not: null } }, orderBy: { endedAt: 'desc' }, select: { endedAt: true, endReason: true } }),
        db.instantRequest.findFirst({
            where: { doctorId, status: { in: ['RINGING', 'ACCEPTED'] } },
            include: { patient: { select: { name: true, age: true, gender: true, allergies: true, allergiesConfirmedAt: true } }, consultation: { select: { id: true, status: true } } },
        }),
        busyDoctorIds(db, [{ id: doctorId, slotMinutes: d.slotMinutes }], now),
    ]);
    // In a call right now, as opposed to a booked patient due soon (also not rung, but not "in a consult").
    const inCall = await db.consultation.count({ where: { doctorId, status: ONGOING, startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } } });
    // Paid in the last half hour and the doctor has not joined yet: the panel shows "Join now".
    const booked = await db.instantRequest.findFirst({
        where: { doctorId, status: 'BOOKED', endedAt: { gte: new Date(now.getTime() - 30 * 60_000) }, consultation: { status: { in: ['CONFIRMED', 'WAITING'] }, doctorJoinedAt: null } },
        orderBy: { endedAt: 'desc' },
        select: { consultationId: true, reason: true, patient: { select: { name: true } } },
    });
    const ring = live?.status === 'RINGING' && live.ringExpiresAt && live.ringExpiresAt > now
        ? {
            id: live.id,
            ringExpiresAt: live.ringExpiresAt,
            reason: live.reason,
            // Enough to decide; the name only after accepting (Aditya, 2026-11-24).
            patientAge: live.patient.age,
            patientGender: live.patient.gender,
            allergies: live.patient.allergies,
            allergiesConfirmed: live.patient.allergiesConfirmedAt !== null,
            feePaise: null as number | null,
        }
        : null;
    if (ring) ring.feePaise = toPaise((await db.doctorProfile.findUniqueOrThrow({ where: { id: doctorId }, select: { consultationFee: true } })).consultationFee);
    const accepted = live?.status === 'ACCEPTED'
        ? {
            id: live.id,
            reason: live.reason,
            patientName: live.patient.name,
            patientAge: live.patient.age,
            patientGender: live.patient.gender,
            payBy: live.payBy,
            consultationId: live.consultation?.id ?? null,
            paid: live.consultation?.status === 'CONFIRMED',
        }
        : null;
    return {
        eligible: takesInstant(d),
        online: !!presence,
        onlineSince: presence?.startedAt ?? null,
        // Why the doctor is offline when they did not switch off themselves, so the panel can say so.
        offlineReason: !presence && last?.endReason && last.endReason !== 'OFF' && last.endedAt && now.getTime() - last.endedAt.getTime() < 6 * 3_600_000
            ? last.endReason
            : null,
        inConsult: inCall > 0,
        bookedSoon: inCall === 0 && inConsult.has(doctorId),
        ring,
        accepted,
        toJoin: booked ? { consultationId: booked.consultationId!, patientName: booked.patient.name, reason: booked.reason } : null,
        serverTime: now,
    };
}

// ── Who is free ──────────────────────────────────────────

const ONGOING: Prisma.ConsultationWhereInput['status'] = { in: ['WAITING', 'IN_PROGRESS'] };
const UPCOMING: Prisma.ConsultationWhereInput['status'] = { in: ['CONFIRMED', 'RESCHEDULED', 'PENDING_PAYMENT'] };

/**
 * Doctors who should not be rung now: in a call, or with a booked consultation due soon (within
 * their slot length plus a buffer) or just started without them.
 */
export async function busyDoctorIds(db: Db, doctors: { id: string; slotMinutes: number }[], now: Date): Promise<Set<string>> {
    if (doctors.length === 0) return new Set();
    const t = now.getTime();
    const rows = await db.consultation.findMany({
        where: {
            doctorId: { in: doctors.map((d) => d.id) },
            startsAt: { gte: new Date(t - 3 * 3_600_000), lte: new Date(t + 3 * 3_600_000) },
            OR: [{ status: ONGOING }, { status: UPCOMING }],
        },
        select: { doctorId: true, status: true, startsAt: true, holdExpiresAt: true },
    });
    const slotOf = new Map(doctors.map((d) => [d.id, d.slotMinutes]));
    const busy = new Set<string>();
    for (const c of rows) {
        if (c.status === 'WAITING' || c.status === 'IN_PROGRESS') { busy.add(c.doctorId); continue; }
        if (c.status === 'PENDING_PAYMENT' && c.holdExpiresAt <= now) continue;
        const lead = (slotOf.get(c.doctorId) ?? 15) * 60_000 + INSTANT.scheduledBufferMs;
        const start = c.startsAt.getTime();
        // Due soon, or started in the last 15 minutes and still waiting for the doctor.
        if (start - lead <= t && t < start + 15 * 60_000) busy.add(c.doctorId);
    }
    return busy;
}

/** Online instant doctors, longest online first, and which of them could take a ring now. */
async function onlineDoctors(db: Db, now: Date) {
    const presences = await db.doctorPresence.findMany({
        where: {
            endedAt: null,
            lastSeenAt: { gte: new Date(now.getTime() - INSTANT.presenceTimeoutMs) },
            doctor: { status: 'APPROVED', specialty: { slug: instantSpecialtySlug() } },
        },
        orderBy: { startedAt: 'asc' },
        select: { doctor: { select: { id: true, slotMinutes: true, consultationFee: true, userId: true } } },
    });
    const doctors = presences.map((p) => p.doctor);
    const [busy, held] = await Promise.all([
        busyDoctorIds(db, doctors, now),
        db.instantRequest.findMany({ where: { status: { in: ['RINGING', 'ACCEPTED'] }, doctorId: { in: doctors.map((d) => d.id) } }, select: { doctorId: true } }),
    ]);
    const taken = new Set(held.map((h) => h.doctorId!));
    return { doctors, free: doctors.filter((d) => !busy.has(d.id) && !taken.has(d.id)) };
}

/** For the "Consult a Doc now" card: how many are online, the fee range, and the next bookable GP time. */
export async function instantAvailability(deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const { doctors, free } = await onlineDoctors(db, now);
    const fees = doctors.map((d) => toPaise(d.consultationFee));
    const specialty = await db.specialty.findFirst({ where: { slug: instantSpecialtySlug(), isActive: true }, select: { id: true, name: true, slug: true } });
    let nextSlot = null;
    if (doctors.length === 0 && specialty) {
        const { rules } = await getActivePolicy(db);
        const s = await db.slot.findFirst({
            where: { status: 'AVAILABLE', startsAt: { gt: new Date(now.getTime() + rules.minLeadMinutes * 60_000) }, doctor: { status: 'APPROVED', specialtyId: specialty.id } },
            orderBy: { startsAt: 'asc' },
            select: { id: true, startsAt: true, doctor: { select: { id: true, displayName: true, consultationFee: true } } },
        });
        if (s) nextSlot = { slotId: s.id, startsAt: s.startsAt, doctorId: s.doctor.id, doctorName: s.doctor.displayName, feePaise: toPaise(s.doctor.consultationFee) };
    }
    return {
        specialty,
        online: doctors.length,
        free: free.length,
        feeMinPaise: fees.length ? Math.min(...fees) : null,
        feeMaxPaise: fees.length ? Math.max(...fees) : null,
        nextSlot,
    };
}

// ── Pushes (best effort; the screens poll anyway) ────────

async function pushTo(db: Db, userId: string, title: string, body: string, url: string, channelId: PushChannelId, send?: ExpoSend) {
    if (pushDisabled()) return;
    try {
        const tokens = (await db.pushToken.findMany({ where: { userId }, select: { token: true } })).map((t) => t.token);
        if (!tokens.length) return;
        await deliverPush(db, tokens, {
            title, body, channelId, sound: channelId === 'teleconsult-call' ? 'teleconsult_call.wav' : 'default', priority: 'high', ttl: 60,
            interruptionLevel: 'time-sensitive', data: { url, channelId, kind: 'INSTANT' },
        }, send ?? sendViaExpo);
    } catch (e) {
        logger.warn({ error: (e as Error).message, userId }, 'instant_push_failed');
    }
}

// ── The matcher ──────────────────────────────────────────

let running: Promise<unknown> | null = null;
let lastRun = 0;

/** For polls and check-ins: a matcher failure is logged, never turned into a failed screen. */
async function advanceSafely(deps: InstantDeps & { throttle?: boolean }) {
    try {
        await advanceInstant(deps);
    } catch (e) {
        logger.error({ error: e }, 'instant_advance_failed');
    }
}

/** Runs the matcher soon, at most about once a second, sharing a run already in progress. */
export function kickInstant(deps: { db?: Db } = {}) {
    return advanceInstant({ db: deps.db, throttle: true }).catch((e) => logger.error({ error: e }, 'instant_advance_failed'));
}

export async function advanceInstant(deps: InstantDeps & { throttle?: boolean } = {}) {
    if (deps.throttle) {
        if (running) return running;
        if (Date.now() - lastRun < 1000) return;
        lastRun = Date.now();
        running = runAdvance(deps).finally(() => { running = null; });
        return running;
    }
    return runAdvance(deps);
}

async function runAdvance(deps: InstantDeps) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    await closeStalePresences(db, now);
    const out = { missed: 0, unpaid: 0, booked: 0, noMatch: 0, rung: 0 };

    // 1. Rings nobody answered: next doctor, and a doctor who misses too many in a row goes offline.
    const expired = await db.instantRequest.findMany({ where: { status: 'RINGING', ringExpiresAt: { lte: now } }, select: { id: true, doctorId: true } });
    for (const r of expired) {
        if (!(await handBack(db, r.id, r.doctorId!, now, true))) continue;
        out.missed++;
        const p = await db.doctorPresence.findFirst({ where: { doctorId: r.doctorId!, endedAt: null }, select: { id: true, missedRings: true } });
        if (!p) continue;
        const missed = p.missedRings + 1;
        await db.doctorPresence.updateMany({
            where: { id: p.id, endedAt: null },
            data: missed >= INSTANT.missedRingsLimit ? { missedRings: missed, endedAt: now, endReason: 'MISSED_RINGS' } : { missedRings: missed },
        });
    }

    // 2. Accepted requests: paid ones are done; unpaid past the time free the doctor (and end the hold).
    const accepted = await db.instantRequest.findMany({
        where: { status: 'ACCEPTED', OR: [{ payBy: { lte: new Date(now.getTime() - INSTANT.payGraceMs) } }, { consultation: { status: { notIn: ['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'] } } }] },
        select: { id: true, userId: true, consultationId: true },
    });
    for (const r of accepted) {
        const outcome = await settleAccepted(db, r.id, r.consultationId, now);
        if (outcome === 'BOOKED') out.booked++;
        if (outcome === 'UNPAID') out.unpaid++;
    }

    // 3. Searches past their time end with nothing charged.
    const over = await db.instantRequest.findMany({ where: { status: 'SEARCHING', searchEndsAt: { lte: now } }, select: { id: true, userId: true } });
    for (const r of over) {
        const res = await db.instantRequest.updateMany({ where: { id: r.id, status: 'SEARCHING' }, data: { status: 'NO_MATCH', endedAt: now } });
        if (res.count === 1) {
            out.noMatch++;
            void pushTo(db, r.userId, 'No Doc was free', 'Nothing was charged. Tap to book a time with a doctor.', 'docnow://consult', 'reminders', deps.send);
        }
    }

    // 4. Ring free doctors for waiting requests, oldest first.
    const waiting = await db.instantRequest.findMany({ where: { status: 'SEARCHING', searchEndsAt: { gt: now } }, orderBy: { createdAt: 'asc' }, take: 50 });
    if (waiting.length) {
        const { free } = await onlineDoctors(db, now);
        for (const r of waiting) {
            for (const d of free.filter((x) => !r.triedDoctorIds.includes(x.id))) {
                if (await ring(db, r.id, d.id, now)) {
                    free.splice(free.indexOf(d), 1);
                    out.rung++;
                    void pushTo(db, d.userId, 'Patient waiting for a Doc', 'Instant consult request. 60 seconds to accept.', 'docnow://doctor', 'teleconsult-call', deps.send);
                    break;
                }
            }
            if (free.length === 0) break;
        }
    }
    if (out.missed || out.unpaid || out.booked || out.noMatch || out.rung) logger.info(out, 'instant_advance');
    return out;
}

/** False when the request moved on, or the doctor was just taken by another request (unique index). */
async function ring(db: Db, requestId: string, doctorId: string, now: Date): Promise<boolean> {
    try {
        const res = await db.instantRequest.updateMany({
            where: { id: requestId, status: 'SEARCHING', searchEndsAt: { gt: now }, NOT: { triedDoctorIds: { has: doctorId } } },
            data: { status: 'RINGING', doctorId, ringExpiresAt: new Date(now.getTime() + INSTANT.ringMs), rings: { increment: 1 } },
        });
        return res.count === 1;
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
        throw e;
    }
}

const PAID_STATUSES = ['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR', 'REFUNDED', 'RESCHEDULED'];

/**
 * An accepted request whose time to pay is over, or whose booking moved on. Paid: BOOKED. Not paid:
 * the hold expires in the same transaction, so a payment landing later is refunded (an instant
 * booking is never re-claimed late; see reclaimExpired) and can never confirm with a freed doctor.
 */
async function settleAccepted(db: Db, requestId: string, consultationId: string | null, now: Date): Promise<'BOOKED' | 'UNPAID' | null> {
    return db.$transaction(async (tx) => {
        let paid = false;
        if (consultationId) {
            const c = await tx.consultation.findUnique({ where: { id: consultationId }, select: { status: true } });
            if (c?.status === 'PENDING_PAYMENT') {
                const ended = await tx.instantRequest.findFirst({ where: { id: requestId, payBy: { lte: new Date(now.getTime() - INSTANT.payGraceMs) } }, select: { id: true } });
                if (!ended) return null;
                // Conditional: if the payment confirms in the same instant, this does nothing and the request is booked.
                if (!(await expireHold(tx, consultationId))) {
                    const again = await tx.consultation.findUniqueOrThrow({ where: { id: consultationId }, select: { status: true } });
                    paid = PAID_STATUSES.includes(again.status);
                }
            } else paid = !!c && PAID_STATUSES.includes(c.status);
        }
        if (!paid) {
            const late = await tx.instantRequest.findFirst({ where: { id: requestId, payBy: { lte: new Date(now.getTime() - INSTANT.payGraceMs) } }, select: { id: true } });
            if (!late) return null;
        }
        const status = paid ? 'BOOKED' : 'UNPAID';
        const res = await tx.instantRequest.updateMany({ where: { id: requestId, status: 'ACCEPTED' }, data: { status, endedAt: now } });
        return res.count === 1 ? status : null;
    });
}

// ── Doctor answers a ring ────────────────────────────────

/**
 * Accept: only the doctor being rung, only before the ring runs out; a second tab or a late click
 * gets a clear answer. Makes the slot at "now" (blocked until paid) and blocks the doctor's free
 * slots under it, so no scheduled patient can be booked across the instant call.
 */
export async function acceptInstant(doctorId: string, requestId: string, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const d = await db.doctorProfile.findUniqueOrThrow({ where: { id: doctorId }, select: { slotMinutes: true, displayName: true } });
    const won = await db.$transaction(async (tx) => {
        const res = await tx.instantRequest.updateMany({
            where: { id: requestId, status: 'RINGING', doctorId, ringExpiresAt: { gt: now } },
            data: { status: 'ACCEPTED', acceptedAt: now, payBy: new Date(now.getTime() + INSTANT.payMs), ringExpiresAt: null },
        });
        if (res.count !== 1) return false;
        const endsAt = new Date(now.getTime() + d.slotMinutes * 60_000);
        const slot = await tx.slot.create({ data: { doctorId, startsAt: now, endsAt, status: 'BLOCKED' } });
        await tx.instantRequest.update({ where: { id: requestId }, data: { slotId: slot.id } });
        await tx.doctorPresence.updateMany({ where: { doctorId, endedAt: null }, data: { missedRings: 0 } });
        return true;
    });
    if (!won) {
        const r = await db.instantRequest.findUnique({ where: { id: requestId }, select: { status: true, doctorId: true } });
        if (!r) throw new DoctorError(404, 'Not found');
        // Accepted already, from another tab or device: same answer, nothing done twice.
        if (r.status === 'ACCEPTED' && r.doctorId === doctorId) return doctorInstantState(doctorId, { db, now });
        throw new DoctorError(409, REQUEST_MOVED);
    }
    const r = await db.instantRequest.findUniqueOrThrow({ where: { id: requestId }, select: { userId: true } });
    void pushTo(db, r.userId, `${doctorTitle(d.displayName)} is ready for you`, 'Pay within 3 minutes to start your consultation.', 'docnow://consult/now', 'teleconsult-call', deps.send);
    return doctorInstantState(doctorId, { db, now });
}

export async function declineInstant(doctorId: string, requestId: string, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const done = await handBack(db, requestId, doctorId, now, false);
    if (!done) {
        const r = await db.instantRequest.findUnique({ where: { id: requestId }, select: { id: true } });
        if (!r) throw new DoctorError(404, 'Not found');
    } else {
        // A decline is an answer, not a missed ring.
        await db.doctorPresence.updateMany({ where: { doctorId, endedAt: null }, data: { missedRings: 0 } });
        if (!deps.now) void kickInstant({ db });
    }
    return doctorInstantState(doctorId, { db, now });
}

// ── Patient side ─────────────────────────────────────────

export async function startInstant(input: { userId: string; patientId: string; reason: unknown; shareRecord?: boolean }, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const reason = cleanInstantReason(input.reason);
    const patient = await db.patient.findFirst({ where: { id: input.patientId, userId: input.userId }, select: { id: true } });
    if (!patient) throw new DoctorError(404, 'Not found');
    const live = await db.instantRequest.findFirst({ where: { userId: input.userId, status: { in: LIVE } } });
    // One search per account: a second tab or a double tap gets the one already running.
    if (live) return instantView(input.userId, live.id, { db, now });
    const { doctors } = await onlineDoctors(db, now);
    if (doctors.length === 0) throw new DoctorError(409, NO_DOCTORS_ONLINE);
    let id: string;
    try {
        id = (await db.instantRequest.create({
            data: { userId: input.userId, patientId: patient.id, reason, shareRecord: !!input.shareRecord, searchEndsAt: new Date(now.getTime() + INSTANT.searchMs), createdAt: now },
        })).id;
    } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        const again = await db.instantRequest.findFirstOrThrow({ where: { userId: input.userId, status: { in: LIVE } } });
        return instantView(input.userId, again.id, { db, now });
    }
    await advanceInstant({ db, now, send: deps.send });
    return instantView(input.userId, id, { db, now });
}

/** The request as the patient's screen needs it. The doctor appears only once they accept. */
export async function instantView(userId: string, requestId: string, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const r = await db.instantRequest.findFirst({
        where: { id: requestId, userId },
        include: {
            patient: { select: { id: true, name: true, relation: true } },
            doctor: { select: { id: true, displayName: true, photoUrl: true, qualification: true, experienceYears: true, languages: true, consultationFee: true, specialty: { select: { name: true } } } },
            consultation: { select: { id: true, status: true } },
        },
    });
    if (!r) throw new DoctorError(404, 'Not found');
    const searching = r.status === 'SEARCHING' || r.status === 'RINGING';
    const [ahead, online] = searching
        ? await Promise.all([
            db.instantRequest.count({ where: { status: 'SEARCHING', createdAt: { lt: r.createdAt } } }),
            onlineDoctors(db, now),
        ])
        : [0, null];
    const showDoctor = (r.status === 'ACCEPTED' || r.status === 'BOOKED') && r.doctor;
    return {
        id: r.id,
        // A ring in progress is still "looking" to the patient: who is being asked is not shown.
        status: r.status === 'RINGING' ? ('SEARCHING' as const) : r.status,
        reason: r.reason,
        shareRecord: r.shareRecord,
        patient: { id: r.patient.id, name: r.patient.name, relation: r.patient.relation },
        createdAt: r.createdAt,
        searchEndsAt: r.searchEndsAt,
        serverTime: now,
        position: searching ? ahead + 1 : null,
        // A Doc is being asked about this request right now (which one is never shown).
        asking: r.status === 'RINGING',
        doctorsOnline: online?.doctors.length ?? null,
        doctorsFree: online?.free.length ?? null,
        doctor: showDoctor ? {
            id: r.doctor!.id,
            displayName: r.doctor!.displayName,
            photoUrl: r.doctor!.photoUrl,
            qualification: r.doctor!.qualification,
            experienceYears: r.doctor!.experienceYears,
            languages: r.doctor!.languages,
            specialty: r.doctor!.specialty.name,
            feePaise: toPaise(r.doctor!.consultationFee),
        } : null,
        payBy: r.status === 'ACCEPTED' ? r.payBy : null,
        slotId: r.status === 'ACCEPTED' || r.status === 'BOOKED' ? r.slotId : null,
        consultationId: r.consultation?.id ?? null,
        consultationStatus: r.consultation?.status ?? null,
    };
}

/** The patient's screen polls this; it also moves the queue along. */
export async function pollInstant(userId: string, requestId: string, deps: InstantDeps = {}) {
    await advanceSafely({ db: deps.db, now: deps.now, send: deps.send, throttle: !deps.now });
    return instantView(userId, requestId, deps);
}

export async function activeInstant(userId: string, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const r = await db.instantRequest.findFirst({ where: { userId, status: { in: LIVE } }, select: { id: true } });
    return r ? instantView(userId, r.id, deps) : null;
}

/** "Stop looking", or "Not now" after an accept: nothing has been charged, and the doctor is freed. */
export async function cancelInstant(userId: string, requestId: string, deps: InstantDeps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const r = await db.instantRequest.findFirst({ where: { id: requestId, userId } });
    if (!r) throw new DoctorError(404, 'Not found');
    if (r.status === 'BOOKED') throw new DoctorError(409, ALREADY_PAID);
    if (r.status === 'SEARCHING' || r.status === 'RINGING') {
        await db.instantRequest.updateMany({ where: { id: r.id, status: { in: ['SEARCHING', 'RINGING'] } }, data: { status: 'CANCELLED', endedAt: now, ringExpiresAt: null } });
    } else if (r.status === 'ACCEPTED') {
        const ok = await db.$transaction(async (tx) => {
            if (r.consultationId) {
                const c = await tx.consultation.findUniqueOrThrow({ where: { id: r.consultationId }, select: { status: true } });
                if (c.status === 'PENDING_PAYMENT' && !(await expireHold(tx, r.consultationId))) return false;
                if (PAID_STATUSES.includes(c.status)) return false;
            }
            await tx.instantRequest.updateMany({ where: { id: r.id, status: 'ACCEPTED' }, data: { status: 'CANCELLED', endedAt: now } });
            return true;
        });
        if (!ok) throw new DoctorError(409, ALREADY_PAID);
    }
    if (!deps.now) void kickInstant({ db });
    return instantView(userId, requestId, { db, now });
}

/** The instant request this booking call pays for, checked; null for an ordinary booking. */
export async function instantForBooking(db: Db | Tx, input: { userId: string; patientId: string; slotId: string; instantRequestId?: string }, now: Date) {
    if (!input.instantRequestId) return null;
    const r = await db.instantRequest.findFirst({ where: { id: input.instantRequestId, userId: input.userId } });
    if (!r || r.slotId !== input.slotId || r.patientId !== input.patientId) throw new DoctorError(404, 'Not found');
    if (r.status !== 'ACCEPTED' || !r.payBy || r.payBy <= now) throw new DoctorError(409, INSTANT_ENDED);
    return r;
}

/**
 * Inside the booking transaction: ties the new consultation to the request and books its slot. The
 * request may get a new consultation only when the last attempt ended unpaid, so one slot never has
 * two live bookings. False means another attempt is live or the request moved on.
 */
export async function claimInstantSlot(tx: Tx, requestId: string, slotId: string, consultationId: string, now: Date): Promise<boolean> {
    const res = await tx.instantRequest.updateMany({
        where: {
            id: requestId,
            status: 'ACCEPTED',
            payBy: { gt: now },
            OR: [{ consultationId: null }, { consultation: { status: { in: ['EXPIRED', 'CANCELLED'] } } }],
        },
        data: { consultationId },
    });
    if (res.count !== 1) return false;
    const slot = await tx.slot.updateMany({ where: { id: slotId, status: { in: ['BLOCKED', 'AVAILABLE'] } }, data: { status: 'BOOKED' } });
    return slot.count === 1;
}


let timer: NodeJS.Timeout | null = null;
/** The matcher's heartbeat: rings time out and searches end even when nobody is polling. */
export function startInstantMatcher(everyMs = 5000) {
    if (timer) return;
    timer = setInterval(() => void kickInstant(), everyMs);
    timer.unref?.();
    logger.info({ everyMs }, 'instant_matcher_started');
}
