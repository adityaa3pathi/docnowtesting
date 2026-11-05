/**
 * Joining and ending the video call. Patient join moves CONFIRMED to WAITING; doctor join moves
 * on to IN_PROGRESS; only the doctor ends it. Every status change is a conditional update.
 */
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';
import { ConsultVideo, VideoRole, realConsultVideo } from './consultations.video';
import type { ConsultationStatus } from './consultations.types';
import { resolveAccess } from './consultations.family';
import { DEFAULT_RULES, type Rules } from './consultations.policy';

const JOINABLE: ConsultationStatus[] = ['CONFIRMED', 'WAITING', 'IN_PROGRESS'];
export const JOIN_EARLY_MS = 10 * 60_000;
export const JOIN_LATE_MS = 15 * 60_000;

/** Telemedicine consent the person gave on the join screen (the routes refuse a join without it). */
export interface JoinConsent {
    channel: 'app' | 'web' | 'guest-link';
    /** Which wording was shown, e.g. CONSENT_VERSION. */
    version: string;
    userId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}
/** The current consent wording: NMC Telemedicine Practice Guidelines (2020), first DocNow text. */
export const CONSENT_VERSION = 'nmc-tpg-2020-v1';
export const CONSENT_REQUIRED = 'Please accept the teleconsultation consent to join';

type Deps = { video?: ConsultVideo; now?: Date; consent?: JoinConsent };

const select = {
    id: true, status: true, type: true, roomId: true, startsAt: true, doctorJoinedAt: true, patientJoinedAt: true,
    policySnapshot: true, slot: { select: { endsAt: true } }, userId: true, patientId: true,
    patient: { select: { name: true } }, doctor: { select: { displayName: true } }, user: { select: { name: true } },
} as const;
type Joinable = {
    id: string; status: ConsultationStatus; type: string; roomId: string | null; startsAt: Date;
    doctorJoinedAt: Date | null; patientJoinedAt: Date | null; policySnapshot: unknown; slot: { endsAt: Date };
    patient: { name: string }; doctor: { displayName: string };
};

/** The no-show waits saved with the booking, so a later policy edit never changes a booked consultation. */
export function noShowDeadlines(c: { startsAt: Date; policySnapshot: unknown }) {
    const rules = { ...DEFAULT_RULES, ...(c.policySnapshot as Partial<Rules>) };
    return {
        doctorBy: new Date(c.startsAt.getTime() + rules.doctorNoShowWaitMinutes * 60_000),
        patientBy: new Date(c.startsAt.getTime() + rules.patientNoShowWaitMinutes * 60_000),
    };
}

/** From this long after the start, a doctor who has not joined counts as late and the patient gets options. */
export const DOCTOR_LATE_AFTER_MS = 5 * 60_000;
const LATE_STATUSES: ConsultationStatus[] = ['CONFIRMED', 'WAITING'];

/**
 * The server's own check behind every "doctor is late" option (free reschedule, another doctor,
 * full refund), so a patient cannot claim lateness to skip the cancellation tiers.
 */
export function isDoctorLate(c: { status: ConsultationStatus; startsAt: Date; doctorJoinedAt: Date | null }, now: Date): boolean {
    return LATE_STATUSES.includes(c.status) && !c.doctorJoinedAt && now.getTime() >= c.startsAt.getTime() + DOCTOR_LATE_AFTER_MS;
}

function checkJoinable(c: Joinable, now: Date) {
    if (c.type === 'CHAT') throw new DoctorError(400, 'Chat consultations are not available yet');
    if (!JOINABLE.includes(c.status)) throw new DoctorError(409, 'This consultation cannot be joined');
    if (now.getTime() < c.startsAt.getTime() - JOIN_EARLY_MS) {
        throw new DoctorError(409, 'You can join from 10 minutes before the start time');
    }
    if (now.getTime() > c.slot.endsAt.getTime() + JOIN_LATE_MS) throw new DoctorError(409, 'This consultation has ended');
}

// The room name is fixed per consultation, so two first joins still meet in one room.
async function ensureRoom(c: Joinable, video: ConsultVideo): Promise<string> {
    if (c.roomId) return c.roomId;
    const roomId = await video.createRoom(`consult-${c.id}`);
    await prisma.consultation.updateMany({ where: { id: c.id, roomId: null }, data: { roomId } });
    const saved = await prisma.consultation.findUnique({ where: { id: c.id }, select: { roomId: true } });
    return saved!.roomId!;
}

// The no-show job may have closed the consultation between our read and our write.
async function assertStillJoinable(id: string) {
    const after = await prisma.consultation.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (!JOINABLE.includes(after.status)) throw new DoctorError(409, 'This consultation cannot be joined');
}

export type CallParty = 'doctor' | 'patient' | 'caretaker';

function role(person: CallParty, type: string): VideoRole {
    return type === 'AUDIO' ? `${person}-audio` : person;
}

/**
 * Room identities say who someone is, so every client can tell the doctor from the patient and
 * the caregiver in a three-way call. Two sessions of one patient (app and web) share an identity,
 * so the newer one replaces the older instead of showing twice.
 */
export const callIdentity = {
    doctor: (doctorId: string) => `doctor:${doctorId}`,
    patient: (patientId: string) => `patient:${patientId}`,
    caretaker: (userId: string) => `caretaker:${userId}`,
};

type Joining = Joinable & { userId: string; patientId: string; user: { name: string | null } };

/**
 * Anyone on the patient's side entering the room. Their arrival counts as the patient being
 * present (so the doctor can start and no-show rules hold), and records which side came.
 */
async function joinPatientSide(c: Joining, party: 'patient' | 'caretaker', who: { identity: string; name: string; family: boolean }, deps: Deps) {
    const video = deps.video ?? realConsultVideo();
    const now = deps.now ?? new Date();
    checkJoinable(c, now);
    const roomId = await ensureRoom(c, video);
    const consent = deps.consent;
    await prisma.$transaction([
        // The first consent per person is the record; rejoining after a dropped call adds nothing.
        ...(consent
            ? [prisma.consultationConsent.createMany({
                data: [{
                    consultationId: c.id, identity: who.identity, userId: consent.userId ?? null, channel: consent.channel, version: consent.version,
                    ipAddress: consent.ipAddress ?? null, userAgent: consent.userAgent?.slice(0, 300) ?? null,
                }],
                skipDuplicates: true,
            })]
            : []),
        prisma.consultation.updateMany({ where: { id: c.id, status: 'CONFIRMED' }, data: { status: 'WAITING' } }),
        prisma.consultation.updateMany({ where: { id: c.id, status: { in: JOINABLE }, patientJoinedAt: null }, data: { patientJoinedAt: now } }),
        ...(party === 'caretaker'
            ? [prisma.consultation.updateMany({ where: { id: c.id, caregiverJoinedAt: null }, data: { caregiverJoinedAt: now, isCaregiverJoined: true } })]
            : []),
        ...(who.family ? [prisma.consultation.updateMany({ where: { id: c.id, familyJoinedAt: null }, data: { familyJoinedAt: now } })] : []),
    ]);
    await assertStillJoinable(c.id);
    const r = role(party, c.type);
    return { url: video.url(), roomId, role: r, identity: who.identity, token: await video.joinToken(roomId, who.identity, who.name, r) };
}

/**
 * Join from the app. The booker of their own visit is the patient; the booker of a family visit is
 * the caregiver; the family member who accepted the booking is the patient.
 */
export async function patientJoin(userId: string, consultationId: string, deps: Deps = {}) {
    const found = await resolveAccess(userId, consultationId);
    if (!found) throw new DoctorError(404, 'Not found');
    if (found.access.kind === 'family-pending') throw new DoctorError(409, 'Please confirm this consultation is for you first');
    const c = await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId }, select });
    const { access } = found;
    if (access.kind === 'booker' && access.forFamily) {
        return joinPatientSide(c, 'caretaker', { identity: callIdentity.caretaker(userId), name: `${c.user.name || 'Family'} (family)`, family: false }, deps);
    }
    return joinPatientSide(c, 'patient', { identity: callIdentity.patient(c.patientId), name: c.patient.name, family: access.kind === 'family' }, deps);
}

// ── Zero-login web room (docnow.in/call/<guestToken>) ───

export const GUEST_LINK_ENDED = 'This consultation link has expired';
export const GUEST_LINK_CANCELLED = 'This consultation was cancelled';

const guestSelect = {
    ...select,
    doctor: { select: { displayName: true, photoUrl: true, qualification: true, specialty: { select: { name: true } } } },
    patient: { select: { name: true, preferredLanguage: true } },
    _count: { select: { attachments: true } },
} as const;

async function guestConsultation(token: string) {
    // Tokens are UUIDs; anything else cannot match and is not worth a query.
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new DoctorError(404, 'Not found');
    const c = await prisma.consultation.findUnique({ where: { guestToken: token }, select: guestSelect });
    if (!c) throw new DoctorError(404, 'Not found');
    if (['CANCELLED', 'REFUNDED', 'NO_SHOW_DOCTOR', 'EXPIRED', 'PENDING_PAYMENT'].includes(c.status)) throw new DoctorError(410, GUEST_LINK_CANCELLED);
    return c;
}

/** What the web room shows before joining. Read-only, so link previews and refreshes change nothing. */
export async function guestInfo(token: string, now = new Date()) {
    const c = await guestConsultation(token);
    const opensAt = new Date(c.startsAt.getTime() - JOIN_EARLY_MS);
    const closesAt = new Date(c.slot.endsAt.getTime() + JOIN_LATE_MS);
    if (now > closesAt || c.status === 'COMPLETED' || c.status === 'NO_SHOW_PATIENT') throw new DoctorError(410, GUEST_LINK_ENDED);
    return {
        status: c.status,
        type: c.type,
        startsAt: c.startsAt,
        endsAt: c.slot.endsAt,
        opensAt,
        window: now < opensAt ? ('early' as const) : ('open' as const),
        doctorJoined: c.doctorJoinedAt !== null,
        // A first name is enough for "Namaste Sunita ji"; nothing clinical is ever on this page.
        patientFirstName: c.patient.name.trim().split(/\s+/)[0] ?? '',
        language: c.patient.preferredLanguage === 'en' ? ('en' as const) : ('hi' as const),
        // Only how many: anyone holding this link could otherwise open the patient's records.
        documentsShared: c._count.attachments,
        doctor: {
            name: c.doctor.displayName,
            photoUrl: c.doctor.photoUrl,
            qualification: c.doctor.qualification,
            specialty: c.doctor.specialty.name,
        },
    };
}

/** Joins the family member from the web link, as the patient. */
export async function guestJoin(token: string, deps: Deps = {}) {
    const c = await guestConsultation(token);
    const now = deps.now ?? new Date();
    if (now.getTime() > c.slot.endsAt.getTime() + JOIN_LATE_MS || c.status === 'COMPLETED') throw new DoctorError(410, GUEST_LINK_ENDED);
    return joinPatientSide(c, 'patient', { identity: callIdentity.patient(c.patientId), name: c.patient.name, family: true }, deps);
}

export async function doctorJoin(doctorId: string, doctorUserId: string, consultationId: string, deps: Deps = {}) {
    const video = deps.video ?? realConsultVideo();
    const now = deps.now ?? new Date();
    const c = await prisma.consultation.findFirst({ where: { id: consultationId, doctorId }, select });
    if (!c) throw new DoctorError(404, 'Not found');
    checkJoinable(c, now);
    if (!c.doctorJoinedAt && now > noShowDeadlines(c).doctorBy) {
        throw new DoctorError(409, 'The time to start this consultation has passed; the patient will be refunded');
    }
    const roomId = await ensureRoom(c, video);
    await prisma.$transaction([
        prisma.consultation.updateMany({ where: { id: c.id, status: 'CONFIRMED' }, data: { status: 'WAITING' } }),
        prisma.consultation.updateMany({ where: { id: c.id, status: 'WAITING' }, data: { status: 'IN_PROGRESS', startedAt: now } }),
        prisma.consultation.updateMany({ where: { id: c.id, status: 'IN_PROGRESS', doctorJoinedAt: null }, data: { doctorJoinedAt: now } }),
    ]);
    await assertStillJoinable(c.id);
    const r = role('doctor', c.type);
    const identity = callIdentity.doctor(doctorId);
    return { url: video.url(), roomId, role: r, identity, token: await video.joinToken(roomId, identity, `Dr. ${c.doctor.displayName}`, r) };
}

export async function endConsultation(doctorId: string, consultationId: string, deps: Deps = {}) {
    const now = deps.now ?? new Date();
    const res = await prisma.consultation.updateMany({
        where: { id: consultationId, doctorId, status: 'IN_PROGRESS', patientJoinedAt: { not: null } },
        data: { status: 'COMPLETED', endedAt: now },
    });
    if (res.count === 1) {
        const { roomId } = await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId }, select: { roomId: true } });
        // The consultation is already complete; a failed room close only leaves a stale call screen.
        if (roomId) await (deps.video ?? realConsultVideo()).endRoom(roomId).catch((e) => console.error('[Consult] end room failed:', e));
        return { status: 'COMPLETED' as const };
    }
    const c = await prisma.consultation.findFirst({ where: { id: consultationId, doctorId }, select: { status: true } });
    if (!c) throw new DoctorError(404, 'Not found');
    if (c.status === 'IN_PROGRESS') {
        throw new DoctorError(409, 'The patient has not joined yet. If they do not join in time, it is marked as missed automatically');
    }
    throw new DoctorError(409, 'Only a consultation in progress can be ended');
}
