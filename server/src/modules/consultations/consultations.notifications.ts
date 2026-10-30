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
import { dosageSummary, type FamilyLanguage } from './consultations.familyMessages';
import { createSignedToken } from '../../services/signedToken';

export type NoticeKind = 'CONFIRMED' | 'REMINDER' | 'JOIN_NOW' | 'PARTNER_WAITING' | 'DOCTOR_NO_SHOW' | 'PATIENT_NO_SHOW';
export type Recipient = 'patient' | 'doctor';
/** Family bookings add the family member (the patient's own phone) as a third recipient. */
export type AnyRecipient = Recipient | 'family';
export type NoticeChannel = 'whatsapp' | 'push';
type Send = (mobile: string, template: string, language: string, components: WappieTemplateComponent[]) => Promise<{ id: string }>;
/** Messages to a family member's own phone (Patient.phone), in their preferred language. */
export type FamilyNoticeKind = 'FAMILY_BOOKED' | 'FAMILY_JOIN_NOW' | 'FAMILY_PRESCRIPTION';
type Templates = Partial<Record<NoticeKind | FamilyNoticeKind, string>>;
type Deps = { db?: PrismaClient; send?: Send; now?: Date; templates?: Templates };

const MAX_ATTEMPTS = 3;
const REMINDER_LEAD_MS = 60 * 60_000;
export const LOOKBACK_MS = 48 * 3_600_000;
const LANGUAGE = process.env.CONSULT_WA_LANGUAGE || 'en';

function templatesFromEnv(): Templates {
    return {
        // Body {{1}} first name, {{2}} doctor, {{3}} time (BOOKED) or booker; link button {{1}} = path.
        FAMILY_BOOKED: process.env.CONSULT_WA_TEMPLATE_FAMILY_BOOKED,
        FAMILY_JOIN_NOW: process.env.CONSULT_WA_TEMPLATE_FAMILY_JOIN_NOW,
        // Body {{1}} first name, {{2}} doctor, {{3}} dosage summary; link button = signed prescription PDF.
        FAMILY_PRESCRIPTION: process.env.CONSULT_WA_TEMPLATE_FAMILY_PRESCRIPTION,
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
    user: { select: { mobile: true, name: true } },
    doctor: { select: { displayName: true, user: { select: { mobile: true } } } },
    guestToken: true, familyJoinedAt: true,
    patient: { select: { name: true, relation: true, phone: true, preferredLanguage: true, linkedUserId: true, linkDeclinedAt: true } },
    prescriptions: { where: { voidedAt: null }, select: { medicines: true }, take: 1 },
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
export async function claim(db: PrismaClient, consultationId: string, kind: string, recipient: AnyRecipient, channel: NoticeChannel = 'whatsapp'): Promise<boolean> {
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

/**
 * Family member's WhatsApp: the booking with its zero-login call link, the link again when the
 * room opens (until they join), and the prescription. The prescription goes only once the number
 * is proven theirs (they accepted in the app, or attended the call from the link sent to it).
 */
export function dueFamilyNotices(
    c: { status: string; startsAt: Date; slot: { endsAt: Date }; guestToken: string | null; familyJoinedAt: Date | null;
        patient: { relation: string; phone: string | null; linkedUserId: string | null; linkDeclinedAt: Date | null };
        prescriptions: unknown[] },
    now: Date,
): FamilyNoticeKind[] {
    const p = c.patient;
    if (p.relation.trim().toLowerCase() === 'self' || !p.phone || p.linkDeclinedAt) return [];
    const t = now.getTime();
    const start = c.startsAt.getTime();
    const live = ['CONFIRMED', 'WAITING', 'IN_PROGRESS'].includes(c.status);
    const due: FamilyNoticeKind[] = [];
    if (c.guestToken && c.status === 'CONFIRMED' && t < start - JOIN_EARLY_MS) due.push('FAMILY_BOOKED');
    if (c.guestToken && live && !c.familyJoinedAt && t >= start - JOIN_EARLY_MS && t < c.slot.endsAt.getTime() + JOIN_LATE_MS) due.push('FAMILY_JOIN_NOW');
    const verified = !!p.linkedUserId || !!c.familyJoinedAt;
    if (verified && c.prescriptions.length && (c.status === 'IN_PROGRESS' || c.status === 'COMPLETED')) due.push('FAMILY_PRESCRIPTION');
    return due;
}

const familyLanguage = (lang: string): FamilyLanguage => (lang === 'en' ? 'en' : 'hi');
const WA_LANGUAGE: Record<FamilyLanguage, string> = {
    hi: process.env.CONSULT_WA_FAMILY_LANGUAGE_HI || 'hi',
    en: process.env.CONSULT_WA_FAMILY_LANGUAGE_EN || 'en',
};

function familyMessage(kind: FamilyNoticeKind, c: Row): { body: string[]; path: string; language: string } {
    const lang = familyLanguage(c.patient.preferredLanguage);
    const first = c.patient.name.trim().split(/\s+/)[0] || c.patient.name;
    const doctor = `Dr. ${c.doctor.displayName}`;
    const booker = (c.user.name ?? '').trim().split(/\s+/)[0] || (lang === 'hi' ? 'आपके परिवार' : 'your family');
    const callPath = `call/${c.guestToken}`;
    switch (kind) {
        case 'FAMILY_BOOKED':
            return { body: [first, doctor, istDateTime(c.startsAt), booker], path: callPath, language: WA_LANGUAGE[lang] };
        case 'FAMILY_JOIN_NOW':
            return { body: [first, doctor, booker], path: callPath, language: WA_LANGUAGE[lang] };
        case 'FAMILY_PRESCRIPTION': {
            const medicines = (c.prescriptions[0]?.medicines ?? []) as { name: string }[];
            const token = createSignedToken('consult-prescription', c.id, Number(process.env.PRESCRIPTION_LINK_EXPIRY_HOURS || '72'));
            return { body: [first, doctor, dosageSummary(medicines, lang)], path: `api/consult/prescriptions/public/${token}`, language: WA_LANGUAGE[lang] };
        }
    }
}

export async function sendDueNotices(deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const send: Send = deps.send ?? sendTemplateViaWhatsApp;
    const templates = deps.templates ?? templatesFromEnv();
    if (!Object.values(templates).some(Boolean)) return { sent: 0, failed: 0 };

    const rows = await db.consultation.findMany({
        where: {
            status: { in: ['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW_DOCTOR', 'NO_SHOW_PATIENT', 'REFUNDED'] },
            startsAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
        },
        select,
        orderBy: { startsAt: 'asc' },
        take: 500,
    });

    let sent = 0;
    let failed = 0;
    for (const c of rows) {
        const deliveries: { kind: string; to: AnyRecipient; mobile: string; language: string; body: string[]; path: string }[] = [
            ...dueNotices(c, now).map(([kind, to]) => ({
                kind, to, mobile: to === 'doctor' ? c.doctor.user.mobile : c.user.mobile, language: LANGUAGE, ...message(kind, to, c),
            })),
            ...dueFamilyNotices(c, now)
                // The booker signed up with the patient's own number: they already get the booker messages.
                .filter(() => c.patient.phone !== c.user.mobile)
                .map((kind) => ({ kind, to: 'family' as const, mobile: c.patient.phone!, ...familyMessage(kind, c) })),
        ];
        for (const { kind, to, mobile, language, body, path } of deliveries) {
            const template = templates[kind as NoticeKind | FamilyNoticeKind];
            if (!template) continue;
            if (!(await claim(db, c.id, kind, to))) continue;
            try {
                const res = await send(mobile, template, language, [
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
