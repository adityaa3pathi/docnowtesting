/**
 * Joining and ending the video call. Patient join moves CONFIRMED to WAITING; doctor join moves
 * on to IN_PROGRESS; only the doctor ends it. Every status change is a conditional update.
 */
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';
import { ConsultVideo, VideoRole, realConsultVideo } from './consultations.video';
import type { ConsultationStatus } from './consultations.types';

const JOINABLE: ConsultationStatus[] = ['CONFIRMED', 'WAITING', 'IN_PROGRESS'];
export const JOIN_EARLY_MS = 10 * 60_000;
export const JOIN_LATE_MS = 15 * 60_000;

type Deps = { video?: ConsultVideo; now?: Date };

const select = { id: true, status: true, type: true, roomId: true, startsAt: true, slot: { select: { endsAt: true } } } as const;
type Joinable = { id: string; status: ConsultationStatus; type: string; roomId: string | null; startsAt: Date; slot: { endsAt: Date } };

function checkJoinable(c: Joinable, now: Date) {
    if (c.type === 'CHAT') throw new DoctorError(400, 'Chat consultations are not available yet');
    if (!JOINABLE.includes(c.status)) throw new DoctorError(409, 'This consultation cannot be joined');
    if (now.getTime() < c.startsAt.getTime() - JOIN_EARLY_MS) {
        throw new DoctorError(409, 'You can join from 10 minutes before the start time');
    }
    if (now.getTime() > c.slot.endsAt.getTime() + JOIN_LATE_MS) throw new DoctorError(409, 'This consultation has ended');
}

// 100ms returns the existing room for a repeated name, so two first joins still meet in one room.
async function ensureRoom(c: Joinable, video: ConsultVideo): Promise<string> {
    if (c.roomId) return c.roomId;
    const roomId = await video.createRoom(`consult-${c.id}`);
    await prisma.consultation.updateMany({ where: { id: c.id, roomId: null }, data: { roomId } });
    const saved = await prisma.consultation.findUnique({ where: { id: c.id }, select: { roomId: true } });
    return saved!.roomId!;
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
        prisma.consultation.updateMany({ where: { id: c.id, patientJoinedAt: null }, data: { patientJoinedAt: now } }),
    ]);
    const r = role('patient', c.type);
    return { roomId, role: r, token: video.joinToken(roomId, userId, r) };
}

export async function doctorJoin(doctorId: string, doctorUserId: string, consultationId: string, deps: Deps = {}) {
    const video = deps.video ?? realConsultVideo();
    const now = deps.now ?? new Date();
    const c = await prisma.consultation.findFirst({ where: { id: consultationId, doctorId }, select });
    if (!c) throw new DoctorError(404, 'Not found');
    checkJoinable(c, now);
    const roomId = await ensureRoom(c, video);
    await prisma.$transaction([
        prisma.consultation.updateMany({ where: { id: c.id, status: 'CONFIRMED' }, data: { status: 'WAITING' } }),
        prisma.consultation.updateMany({ where: { id: c.id, status: 'WAITING' }, data: { status: 'IN_PROGRESS', startedAt: now } }),
        prisma.consultation.updateMany({ where: { id: c.id, doctorJoinedAt: null }, data: { doctorJoinedAt: now } }),
    ]);
    const r = role('doctor', c.type);
    return { roomId, role: r, token: video.joinToken(roomId, doctorUserId, r) };
}

export async function endConsultation(doctorId: string, consultationId: string, now = new Date()) {
    const res = await prisma.consultation.updateMany({
        where: { id: consultationId, doctorId, status: 'IN_PROGRESS' },
        data: { status: 'COMPLETED', endedAt: now },
    });
    if (res.count === 1) return { status: 'COMPLETED' as const };
    const c = await prisma.consultation.findFirst({ where: { id: consultationId, doctorId }, select: { status: true } });
    if (!c) throw new DoctorError(404, 'Not found');
    throw new DoctorError(409, 'Only a consultation in progress can be ended');
}
