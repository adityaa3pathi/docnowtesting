/**
 * In-call text chat (P9). The doctor, the patient (signed in or on the family web link) and the
 * booking caregiver write to one thread per consultation. It is open while the call is (status
 * WAITING or IN_PROGRESS, up to CHAT_GRACE_MS after the slot ends), then read-only, and it stays
 * with the consultation as part of the doctor's record. Text only in v1: no attachments.
 *
 * Live updates are polling: the client asks for messages after the last seq it has. A seq is
 * taken before its insert commits, so two sends can commit out of order; every read therefore
 * also returns the last OVERLAP_MS of messages, and clients drop ids they already have.
 */
import { Prisma, type ConsultationChatRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';
import { doctorTitle } from './doctors.types';
import { canSeeClinical, resolveAccess } from './consultations.family';
import { JOIN_LATE_MS, callIdentity } from './consultations.room';
import type { ConsultationStatus } from './consultations.types';

export const CHAT_MAX_CHARS = 1000;
export const CHAT_MAX_MESSAGES = 500;
/** How long after the slot's end a call that is still running keeps its chat open. */
export const CHAT_GRACE_MS = 60 * 60_000;
export const CHAT_PAGE = 200;
const OVERLAP_MS = 10_000;
const OPEN: ConsultationStatus[] = ['WAITING', 'IN_PROGRESS'];
/** The family web link stops working for these, as it does for the call (see guestConsultation). */
const GUEST_CLOSED: ConsultationStatus[] = ['CANCELLED', 'REFUNDED', 'NO_SHOW_DOCTOR', 'EXPIRED', 'PENDING_PAYMENT', 'COMPLETED', 'NO_SHOW_PATIENT'];

export const CHAT_CLOSED = 'Chat is closed for this consultation';
export const CHAT_FULL = 'This chat has reached its message limit';

export const chatSendSchema = z.object({
    body: z.string().max(CHAT_MAX_CHARS * 2, `Keep messages under ${CHAT_MAX_CHARS} characters`),
    clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid message id'),
});
// seq is a 4-byte integer column; larger cursors would fail in the query instead of as bad input.
export const chatReadSchema = z.object({ after: z.coerce.number().int().min(0).max(2_147_483_647).default(0) });

/** Who is writing or reading. `identity` is the call identity, so "mine" matches the room. */
export interface ChatParty { role: ConsultationChatRole; identity: string }

const chatSelect = {
    id: true, status: true, type: true, doctorId: true, userId: true, patientId: true,
    slot: { select: { endsAt: true } },
    doctor: { select: { displayName: true } },
    patient: { select: { name: true } },
    user: { select: { name: true } },
} as const;
type ChatConsultation = Prisma.ConsultationGetPayload<{ select: typeof chatSelect }>;

export function chatOpen(c: { status: ConsultationStatus; type: string; slot: { endsAt: Date } }, now: Date): boolean {
    return c.type !== 'CHAT' && OPEN.includes(c.status) && now.getTime() <= c.slot.endsAt.getTime() + CHAT_GRACE_MS;
}

/** Control characters other than newline and tab are dropped; Windows newlines become \n. */
export function cleanBody(raw: string): string {
    // eslint-disable-next-line no-control-regex
    return raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

type Row = { id: string; seq: number; senderRole: ConsultationChatRole; senderIdentity: string; body: string; createdAt: Date };

/** Doctor names come from each message's own sender, so a moved booking never relabels the first doctor's words. */
async function view(c: ChatConsultation, viewer: ChatParty, now: Date, rows: Row[], hasMore = false) {
    const doctorIds = [...new Set(rows.filter((m) => m.senderRole === 'DOCTOR').map((m) => m.senderIdentity.slice('doctor:'.length)))];
    const others = doctorIds.filter((id) => id !== c.doctorId);
    const doctors = new Map<string, string>([[c.doctorId, c.doctor.displayName]]);
    if (others.length) {
        for (const d of await prisma.doctorProfile.findMany({ where: { id: { in: others } }, select: { id: true, displayName: true } })) doctors.set(d.id, d.displayName);
    }
    const name = (m: Row) => {
        if (m.senderRole === 'DOCTOR') {
            const n = doctors.get(m.senderIdentity.slice('doctor:'.length));
            return n ? doctorTitle(n) : 'Doctor';
        }
        return m.senderRole === 'PATIENT' ? c.patient.name : `${c.user.name || 'Family'} (family)`;
    };
    return {
        open: chatOpen(c, now),
        maxChars: CHAT_MAX_CHARS,
        /** More messages after this page: read again from the last seq. */
        hasMore,
        messages: rows.map((m) => ({
            id: m.id,
            seq: m.seq,
            from: m.senderRole,
            name: name(m),
            mine: m.senderIdentity === viewer.identity,
            body: m.body,
            sentAt: m.createdAt,
        })),
    };
}

const rowSelect = { id: true, seq: true, senderRole: true, senderIdentity: true, body: true, createdAt: true } as const;

/** `since`: a doctor who took over a moved booking sees only what was written after the move. */
async function read(c: ChatConsultation, viewer: ChatParty, after: number, now: Date, since?: Date) {
    const rows = await prisma.consultationMessage.findMany({
        where: {
            consultationId: c.id,
            OR: [{ seq: { gt: after } }, { createdAt: { gte: new Date(now.getTime() - OVERLAP_MS) } }],
            ...(since ? { createdAt: { gte: since } } : {}),
        },
        orderBy: { seq: 'asc' },
        take: CHAT_PAGE,
        select: rowSelect,
    });
    return view(c, viewer, now, rows, rows.length === CHAT_PAGE);
}

async function send(c: ChatConsultation, sender: ChatParty, input: z.infer<typeof chatSendSchema>, now: Date) {
    const body = cleanBody(input.body);
    if (!body) throw new DoctorError(400, 'Type a message first');
    if (body.length > CHAT_MAX_CHARS) throw new DoctorError(400, `Keep messages under ${CHAT_MAX_CHARS} characters`);
    const key = { consultationId_senderIdentity_clientId: { consultationId: c.id, senderIdentity: sender.identity, clientId: input.clientId } };
    // A resend of a message already stored answers with it, even if the chat closed meanwhile.
    const existing = await prisma.consultationMessage.findUnique({ where: key, select: rowSelect });
    if (existing) return (await view(c, sender, now, [existing])).messages[0];
    if (!chatOpen(c, now)) throw new DoctorError(409, CHAT_CLOSED);
    // Not atomic with the insert, so two racing sends can pass 500 by one; the cap only stops floods.
    if (await prisma.consultationMessage.count({ where: { consultationId: c.id } }) >= CHAT_MAX_MESSAGES) throw new DoctorError(409, CHAT_FULL);
    try {
        const row = await prisma.consultationMessage.create({
            // Stamped with the same clock the reads use for their overlap window, not the database's.
            data: { consultationId: c.id, senderRole: sender.role, senderIdentity: sender.identity, body, clientId: input.clientId, createdAt: now },
            select: rowSelect,
        });
        return (await view(c, sender, now, [row])).messages[0];
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return (await view(c, sender, now, [await prisma.consultationMessage.findUniqueOrThrow({ where: key, select: rowSelect })])).messages[0];
        }
        throw e;
    }
}

// ── Who may use the chat ──

/** The consultation's current doctor. A reassigned booking leaves the old doctor with a 404. */
async function asDoctor(doctorId: string, consultationId: string) {
    const c = await prisma.consultation.findFirst({ where: { id: consultationId, doctorId }, select: chatSelect });
    if (!c) throw new DoctorError(404, 'Not found');
    // Moved here from another doctor (late-doctor reassign): what the patient wrote before belongs to
    // that visit, like the health-record sharing a new doctor does not inherit.
    const takeover = await prisma.consultationMove.findFirst({
        where: { consultationId, toDoctorId: doctorId, fromDoctorId: { not: doctorId } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });
    return { c, party: { role: 'DOCTOR' as const, identity: callIdentity.doctor(doctorId) }, since: takeover?.createdAt };
}

/** The booker (as patient, or as caregiver for a family visit) or the accepted family member. */
async function asPatientSide(userId: string, consultationId: string) {
    const found = await resolveAccess(userId, consultationId);
    if (!found) throw new DoctorError(404, 'Not found');
    if (!canSeeClinical(found.access)) throw new DoctorError(409, 'Please confirm this consultation is for you first');
    const c = await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId }, select: chatSelect });
    const caretaker = found.access.kind === 'booker' && found.access.forFamily;
    return {
        c,
        party: caretaker
            ? { role: 'CARETAKER' as const, identity: callIdentity.caretaker(userId) }
            : { role: 'PATIENT' as const, identity: callIdentity.patient(c.patientId) },
    };
}

/** The family web link: the patient, and only until the visit is over (the link then expires, as for the call). */
async function asGuest(token: string, now: Date) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new DoctorError(404, 'Not found');
    const c = await prisma.consultation.findUnique({ where: { guestToken: token }, select: chatSelect });
    if (!c) throw new DoctorError(404, 'Not found');
    if (GUEST_CLOSED.includes(c.status) || now.getTime() > c.slot.endsAt.getTime() + JOIN_LATE_MS) throw new DoctorError(410, 'This consultation link has expired');
    return { c, party: { role: 'PATIENT' as const, identity: callIdentity.patient(c.patientId) } };
}

export const doctorChat = {
    read: async (doctorId: string, id: string, after: number, now = new Date()) => {
        const { c, party, since } = await asDoctor(doctorId, id);
        return read(c, party, after, now, since);
    },
    send: async (doctorId: string, id: string, input: z.infer<typeof chatSendSchema>, now = new Date()) => {
        const { c, party } = await asDoctor(doctorId, id);
        return send(c, party, input, now);
    },
};

export const patientChat = {
    read: async (userId: string, id: string, after: number, now = new Date()) => {
        const { c, party } = await asPatientSide(userId, id);
        return read(c, party, after, now);
    },
    send: async (userId: string, id: string, input: z.infer<typeof chatSendSchema>, now = new Date()) => {
        const { c, party } = await asPatientSide(userId, id);
        return send(c, party, input, now);
    },
};

export const guestChat = {
    read: async (token: string, after: number, now = new Date()) => {
        const { c, party } = await asGuest(token, now);
        return read(c, party, after, now);
    },
    send: async (token: string, input: z.infer<typeof chatSendSchema>, now = new Date()) => {
        const { c, party } = await asGuest(token, now);
        return send(c, party, input, now);
    },
};
