/**
 * Super admin "Online now" (P10c): read-only views of instant consults. Who is online and what state
 * each GP is in, live requests, recent outcomes, and hours online (consultations.presenceHours).
 *
 * The states come from onlineInstantDoctors, the same function the matcher rings from, so this page
 * can never disagree with who actually gets rung. The live list carries no patient name or reason;
 * opening one request shows them and writes an AdminAuditLog row (the reason is medical text).
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { INSTANT, onlineInstantDoctors } from './consultations.instant';
import { DoctorError } from './doctors.status';
import type { AdminActor } from './consultations.adminRecords';

type Db = PrismaClient;
type Deps = { db?: Db; now?: Date };

export type OnlineState = 'FREE' | 'RINGING' | 'WAITING_PAYMENT' | 'IN_CALL' | 'SCHEDULED_SOON';

/** One label per online doctor. Every non-FREE state is one the matcher skips. */
export function onlineState(busy: 'IN_CALL' | 'SCHEDULED_SOON' | undefined, held: 'RINGING' | 'ACCEPTED' | undefined): OnlineState {
    if (busy === 'IN_CALL') return 'IN_CALL';
    if (held === 'RINGING') return 'RINGING';
    if (held === 'ACCEPTED') return 'WAITING_PAYMENT';
    if (busy === 'SCHEDULED_SOON') return 'SCHEDULED_SOON';
    return 'FREE';
}

export async function onlineNow(deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const { presences, busy, held } = await onlineInstantDoctors(db, now);
    const doctors = presences.map((p) => ({
        doctorId: p.doctor.id,
        doctorName: p.doctor.displayName,
        state: onlineState(busy.get(p.doctor.id), held.get(p.doctor.id)),
        onlineSince: p.startedAt,
        onlineSeconds: Math.max(0, Math.round((now.getTime() - p.startedAt.getTime()) / 1000)),
        missedRings: p.missedRings,
    }));
    return { now, online: doctors.length, free: doctors.filter((d) => d.state === 'FREE').length, doctors };
}

/** Requests still searching, ringing or waiting for payment: no patient name or reason here. */
export async function liveRequests(deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const rows = await db.instantRequest.findMany({
        where: { status: { in: ['SEARCHING', 'RINGING', 'ACCEPTED'] } },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
            id: true, status: true, createdAt: true, searchEndsAt: true, ringExpiresAt: true, payBy: true, rings: true, triedDoctorIds: true,
            doctor: { select: { id: true, displayName: true } },
        },
    });
    return rows.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        waitingSeconds: Math.max(0, Math.round((now.getTime() - r.createdAt.getTime()) / 1000)),
        searchEndsAt: r.searchEndsAt,
        ringExpiresAt: r.status === 'RINGING' ? r.ringExpiresAt : null,
        payBy: r.status === 'ACCEPTED' ? r.payBy : null,
        /** Doctors asked so far, the one ringing or accepted now included. */
        doctorsTried: r.rings,
        doctor: r.status === 'SEARCHING' ? null : r.doctor ? { id: r.doctor.id, name: r.doctor.displayName } : null,
    }));
}

const ageOn = (dob: Date | null, now: Date) => {
    if (!dob) return null;
    let a = now.getUTCFullYear() - dob.getUTCFullYear();
    const m = now.getUTCMonth() - dob.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) a--;
    return a;
};

/** One request with who it is for and why. Logged: the reason is the patient's own medical text. */
export async function instantRequestDetail(actor: AdminActor, requestId: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const r = await db.instantRequest.findUnique({
        where: { id: requestId },
        select: {
            id: true, status: true, reason: true, shareRecord: true, createdAt: true, searchEndsAt: true, endedAt: true,
            acceptedAt: true, payBy: true, rings: true, triedDoctorIds: true, consultationId: true, patientId: true,
            patient: { select: { name: true, gender: true, dob: true, age: true } },
            doctor: { select: { id: true, displayName: true } },
        },
    });
    if (!r) throw new DoctorError(404, 'Not found');
    await db.adminAuditLog.create({
        data: {
            adminId: actor.adminId,
            adminName: actor.adminName,
            action: 'INSTANT_REQUEST_VIEW',
            entity: 'InstantRequest',
            targetId: r.id,
            newValue: { patientId: r.patientId },
            ipAddress: actor.ipAddress ?? null,
        },
    });
    const tried = r.triedDoctorIds.length
        ? await db.doctorProfile.findMany({ where: { id: { in: r.triedDoctorIds } }, select: { id: true, displayName: true } })
        : [];
    const nameOf = new Map(tried.map((d) => [d.id, d.displayName]));
    return {
        id: r.id,
        status: r.status,
        reason: r.reason,
        shareRecord: r.shareRecord,
        createdAt: r.createdAt,
        searchEndsAt: r.searchEndsAt,
        endedAt: r.endedAt,
        acceptedAt: r.acceptedAt,
        payBy: r.payBy,
        doctorsTried: r.rings,
        patient: { name: r.patient.name, gender: r.patient.gender, age: ageOn(r.patient.dob, now) ?? r.patient.age },
        doctor: r.doctor ? { id: r.doctor.id, name: r.doctor.displayName } : null,
        /** Asked earlier and declined or let the ring run out, in the order asked. */
        passedBy: r.triedDoctorIds.map((id) => ({ id, name: nameOf.get(id) ?? 'Removed doctor' })),
        consultationId: r.consultationId,
    };
}

export const OUTCOME_WINDOWS = { '24h': 86_400_000, '7d': 7 * 86_400_000 } as const;
export type OutcomeWindow = keyof typeof OUTCOME_WINDOWS;

/** What happened to instant requests that ended in the window, and the problems worth a look. */
export async function instantOutcomes(window: OutcomeWindow, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const since = new Date(now.getTime() - OUTCOME_WINDOWS[window]);
    const [ended, lateRefunds, missed] = await Promise.all([
        db.instantRequest.groupBy({ by: ['status'], where: { endedAt: { gte: since } }, _count: { _all: true } }),
        db.consultationRefund.findMany({
            where: { reason: 'LATE_PAYMENT_SLOT_LOST', createdAt: { gte: since }, consultation: { isInstant: true } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, consultationId: true, amountPaise: true, status: true, createdAt: true },
        }),
        db.doctorPresence.findMany({
            where: { endReason: 'MISSED_RINGS', endedAt: { gte: since } },
            orderBy: { endedAt: 'desc' },
            select: { id: true, endedAt: true, doctor: { select: { id: true, displayName: true } } },
        }),
    ]);
    const count = (s: string) => ended.find((e) => e.status === s)?._count._all ?? 0;
    return {
        window,
        since,
        counts: {
            booked: count('BOOKED'),
            noDoctorFound: count('NO_MATCH'),
            unpaid: count('UNPAID'),
            cancelled: count('CANCELLED'),
            latePaymentsRefunded: lateRefunds.length,
            switchedOfflineMissedRings: missed.length,
        },
        lateRefunds: lateRefunds.slice(0, 20),
        switchedOffline: missed.slice(0, 20).map((m) => ({ id: m.id, at: m.endedAt, doctorId: m.doctor.id, doctorName: m.doctor.displayName })),
        rules: { missedRingsLimit: INSTANT.missedRingsLimit, searchMinutes: INSTANT.searchMs / 60_000 },
    };
}
