/**
 * Joining and ending the video call. Patient join moves CONFIRMED to WAITING; doctor join moves
 * on to IN_PROGRESS; only the doctor ends it. Every status change is a conditional update.
 */
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';
import { ConsultVideo, VideoRole, realConsultVideo } from './consultations.video';
import type { ConsultationStatus } from './consultations.types';
import { DEFAULT_RULES, type Rules } from './consultations.policy';

const JOINABLE: ConsultationStatus[] = ['CONFIRMED', 'WAITING', 'IN_PROGRESS'];
export const JOIN_EARLY_MS = 10 * 60_000;
export const JOIN_LATE_MS = 15 * 60_000;

type Deps = { video?: ConsultVideo; now?: Date };

const select = {
    id: true, status: true, type: true, roomId: true, startsAt: true, doctorJoinedAt: true, patientJoinedAt: true,
    policySnapshot: true, slot: { select: { endsAt: true } },
    patient: { select: { name: true } }, doctor: { select: { displayName: true } },
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

function role(person: 'doctor' | 'patient', type: string): VideoRole {
    return type === 'AUDIO' ? `${person}-audio` : person;
}

export async function patientJoin(userId: string, consultationId: string, deps: Deps = {}) {
    const video = deps.video ?? realConsultVideo();
    const now = deps.now ?? new Date();
    const c = await prisma.consultation.findFirst({ where: { id: consultationId, userId }, select });
    if (!c) throw new DoctorError(404, 'Not found');
    checkJoinable(c, now);
    const roomId = await ensureRoom(c, video);
    await prisma.$transaction([
        prisma.consultation.updateMany({ where: { id: c.id, status: 'CONFIRMED' }, data: { status: 'WAITING' } }),
        prisma.consultation.updateMany({ where: { id: c.id, status: { in: JOINABLE }, patientJoinedAt: null }, data: { patientJoinedAt: now } }),
    ]);
    await assertStillJoinable(c.id);
    const r = role('patient', c.type);
    return { url: video.url(), roomId, role: r, token: await video.joinToken(roomId, userId, c.patient.name, r) };
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
    return { url: video.url(), roomId, role: r, token: await video.joinToken(roomId, doctorUserId, `Dr. ${c.doctor.displayName}`, r) };
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
