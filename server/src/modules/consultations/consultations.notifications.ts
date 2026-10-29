/**
 * Consultation WhatsApp messages. Each (consultation, kind, recipient) is claimed in the database
 * before sending, so it goes out at most once; a failure is retried while the message is still due.
 * A kind whose template is not configured is simply off.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logger } from '../../utils/logger';
import { sendTemplateViaWhatsApp, type WappieTemplateComponent } from '../../services/wappieWhatsApp';
import { JOIN_EARLY_MS, JOIN_LATE_MS } from './consultations.room';

export type NoticeKind = 'CONFIRMED' | 'REMINDER' | 'JOIN_NOW' | 'PARTNER_WAITING' | 'DOCTOR_NO_SHOW' | 'PATIENT_NO_SHOW';
export type Recipient = 'patient' | 'doctor';
export type NoticeChannel = 'whatsapp' | 'push';
type Send = (mobile: string, template: string, language: string, components: WappieTemplateComponent[]) => Promise<{ id: string }>;
type Deps = { db?: PrismaClient; send?: Send; now?: Date; templates?: Partial<Record<NoticeKind, string>> };

const MAX_ATTEMPTS = 3;
const REMINDER_LEAD_MS = 60 * 60_000;
export const LOOKBACK_MS = 48 * 3_600_000;
const LANGUAGE = process.env.CONSULT_WA_LANGUAGE || 'en';

function templatesFromEnv(): Partial<Record<NoticeKind, string>> {
    return {
        CONFIRMED: process.env.CONSULT_WA_TEMPLATE_CONFIRMED,
        REMINDER: process.env.CONSULT_WA_TEMPLATE_REMINDER,
        JOIN_NOW: process.env.CONSULT_WA_TEMPLATE_JOIN_NOW,
        PARTNER_WAITING: process.env.CONSULT_WA_TEMPLATE_PARTNER_WAITING,
        DOCTOR_NO_SHOW: process.env.CONSULT_WA_TEMPLATE_DOCTOR_NO_SHOW,
        PATIENT_NO_SHOW: process.env.CONSULT_WA_TEMPLATE_PATIENT_NO_SHOW,
    };
}

const istDateTime = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d).replace(/\//g, '-').replace(',', '') + ' IST';

const select = {
    id: true, status: true, startsAt: true, createdAt: true, doctorId: true,
    doctorJoinedAt: true, patientJoinedAt: true,
    slot: { select: { endsAt: true } },
    patient: { select: { name: true } },
    user: { select: { mobile: true } },
    doctor: { select: { displayName: true, user: { select: { mobile: true } } } },
    refunds: { where: { reason: 'DOCTOR_NO_SHOW' }, select: { amountPaise: true } },
} satisfies Prisma.ConsultationSelect;
type Row = Prisma.ConsultationGetPayload<{ select: typeof select }>;

/** Body text values in template order, and the path the link button opens (template URL ends in {{1}}). */
function message(kind: NoticeKind, to: Recipient, c: Row): { body: string[]; path: string } {
    const when = istDateTime(c.startsAt);
    const path = to === 'doctor' ? `doctor/consultations/${c.id}` : `consult/booking/${c.id}`;
    const other = to === 'doctor' ? c.patient.name : `Dr. ${c.doctor.displayName}`;
    const name = to === 'doctor' ? `Dr. ${c.doctor.displayName}` : c.patient.name;
    switch (kind) {
        case 'CONFIRMED': return { body: [name, other, when], path };
        case 'REMINDER': return { body: [name, other, when], path };
        case 'JOIN_NOW': return { body: [name, other], path };
        case 'PARTNER_WAITING': return { body: [name, other], path };
        // The link offers the same doctor again.
        case 'PATIENT_NO_SHOW': return { body: [name, other], path: `consult/doctors/${c.doctorId}` };
        case 'DOCTOR_NO_SHOW': {
            const rupees = (c.refunds.reduce((s, r) => s + r.amountPaise, 0) / 100).toFixed(2);
            return { body: [name, other, `Rs. ${rupees}`], path };
        }
    }
}

/** Which messages are due for this consultation right now. */
export function dueNotices(
    c: { status: string; startsAt: Date; createdAt: Date; doctorJoinedAt: Date | null; patientJoinedAt: Date | null; slot: { endsAt: Date }; refunds: unknown[] },
    now: Date,
): [NoticeKind, Recipient][] {
    const t = now.getTime();
    const start = c.startsAt.getTime();
    const live = ['CONFIRMED', 'WAITING', 'IN_PROGRESS'].includes(c.status);
    const due: [NoticeKind, Recipient][] = [];
    if (c.status === 'CONFIRMED' && t < start - JOIN_EARLY_MS) due.push(['CONFIRMED', 'patient']);
    if (c.status === 'CONFIRMED' && t >= start - REMINDER_LEAD_MS && t < start - JOIN_EARLY_MS) {
        // A patient who booked within the hour just got the confirmation; a reminder would repeat it.
        if (c.createdAt.getTime() < start - REMINDER_LEAD_MS) due.push(['REMINDER', 'patient']);
        due.push(['REMINDER', 'doctor']);
    }
    if (live && t >= start - JOIN_EARLY_MS && t < c.slot.endsAt.getTime() + JOIN_LATE_MS) {
        due.push(['JOIN_NOW', 'patient'], ['JOIN_NOW', 'doctor']);
        // When one party has joined but the other hasn't, nudge the missing one.
        if (c.doctorJoinedAt && !c.patientJoinedAt) due.push(['PARTNER_WAITING', 'patient']);
        if (c.patientJoinedAt && !c.doctorJoinedAt) due.push(['PARTNER_WAITING', 'doctor']);
    }
    // The refund often completes in the same run, moving the booking on to REFUNDED.
    const doctorMissed = c.status === 'NO_SHOW_DOCTOR' || (c.status === 'REFUNDED' && c.refunds.length > 0);
    if (doctorMissed) due.push(['DOCTOR_NO_SHOW', 'patient']);
    if (c.status === 'NO_SHOW_PATIENT') due.push(['PATIENT_NO_SHOW', 'patient']);
    return due;
}

/**
 * True when this run owns the send: a fresh claim, or a failed one taken back for retry. Each
 * channel has its own row, so WhatsApp and push never block each other.
 */
export async function claim(db: PrismaClient, consultationId: string, kind: string, recipient: Recipient, channel: NoticeChannel = 'whatsapp'): Promise<boolean> {
    try {
        await db.consultationNotification.create({ data: { consultationId, kind, recipient, channel } });
        return true;
    } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    const retry = await db.consultationNotification.updateMany({
        where: { consultationId, kind, recipient, channel, status: 'FAILED', attempts: { lt: MAX_ATTEMPTS } },
        data: { status: 'SENDING', attempts: { increment: 1 } },
    });
    return retry.count === 1;
}

export async function sendDueNotices(deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const send: Send = deps.send ?? sendTemplateViaWhatsApp;
    const templates = deps.templates ?? templatesFromEnv();
    if (!Object.values(templates).some(Boolean)) return { sent: 0, failed: 0 };

    const rows = await db.consultation.findMany({
        where: {
            status: { in: ['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'NO_SHOW_DOCTOR', 'NO_SHOW_PATIENT', 'REFUNDED'] },
            startsAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
        },
        select,
        orderBy: { startsAt: 'asc' },
        take: 500,
    });

    let sent = 0;
    let failed = 0;
    for (const c of rows) {
        for (const [kind, to] of dueNotices(c, now)) {
            const template = templates[kind];
            if (!template) continue;
            if (!(await claim(db, c.id, kind, to))) continue;
            const mobile = to === 'doctor' ? c.doctor.user.mobile : c.user.mobile;
            const { body, path } = message(kind, to, c);
            try {
                const res = await send(mobile, template, LANGUAGE, [
                    { type: 'body', parameters: body.map((text) => ({ type: 'text', text })) },
                    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: path }] },
                ]);
                await db.consultationNotification.update({
                    where: { consultationId_kind_recipient_channel: { consultationId: c.id, kind, recipient: to, channel: 'whatsapp' } },
                    data: { status: 'SENT', providerId: res.id, lastError: null },
                });
                sent++;
            } catch (e: any) {
                failed++;
                logger.warn({ consultationId: c.id, kind, to, error: e?.message }, 'consult_notice_failed');
                await db.consultationNotification.update({
                    where: { consultationId_kind_recipient_channel: { consultationId: c.id, kind, recipient: to, channel: 'whatsapp' } },
                    data: { status: 'FAILED', lastError: String(e?.message ?? e).slice(0, 500) },
                });
            }
        }
    }
    return { sent, failed };
}
