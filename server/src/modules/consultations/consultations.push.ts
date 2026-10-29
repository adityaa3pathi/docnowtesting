/**
 * Consultation push notifications through Expo's push service. It uses the same due rules and the
 * same claim-before-send outbox as WhatsApp (channel "push"), so each push goes out at most once
 * per person and a failure is retried while it is still due. Runs every minute from the
 * consultation timers, and right after a join or an issued prescription so call alerts are not late.
 *
 * Payload contract with the mobile app: `data.url` is a docnow:// link the app opens on tap, and
 * `data.channelId` / `channelId` pick the Android channel (teleconsult-call rings, others do not).
 * Lock-screen text never names the patient.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { deliverPush, pushDisabled, sendViaExpo, type ExpoMessage, type ExpoSend, type PushChannelId } from '../../services/expoPush';
import { logger } from '../../utils/logger';
import { claim, dueNotices, LOOKBACK_MS, type NoticeKind, type Recipient } from './consultations.notifications';

export type { ExpoMessage, ExpoSend, ExpoTicket } from '../../services/expoPush';

export type PushKind = NoticeKind | 'PRESCRIPTION_ISSUED';
type ConsultPushData = { kind: PushKind; consultationId: string };
export type ConsultPushMessage = Omit<ExpoMessage<ConsultPushData>, 'to'>;

/** Must match the file bundled by the app's expo-notifications plugin (used by iOS; Android uses the channel). */
const CALL_SOUND = 'teleconsult_call.wav';

const select = {
    id: true, status: true, startsAt: true, createdAt: true, userId: true,
    doctorJoinedAt: true, patientJoinedAt: true,
    slot: { select: { endsAt: true } },
    doctor: { select: { displayName: true, userId: true } },
    refunds: { where: { reason: 'DOCTOR_NO_SHOW' }, select: { amountPaise: true } },
    prescriptions: { where: { voidedAt: null }, select: { id: true }, take: 1 },
} satisfies Prisma.ConsultationSelect;
export type PushRow = Prisma.ConsultationGetPayload<{ select: typeof select }>;

/** The WhatsApp rules, plus a push once the patient's prescription is ready. */
export function duePushes(c: PushRow, now: Date): [PushKind, Recipient][] {
    const due: [PushKind, Recipient][] = dueNotices(c, now);
    if (c.prescriptions.length && (c.status === 'IN_PROGRESS' || c.status === 'COMPLETED')) due.push(['PRESCRIPTION_ISSUED', 'patient']);
    return due;
}

const istTime = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toUpperCase();
const istDay = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }).format(d);

export function pushMessage(kind: PushKind, to: Recipient, c: PushRow): ConsultPushMessage {
    const dr = `Dr. ${c.doctor.displayName}`;
    const at = istTime(c.startsAt);
    const url = to === 'doctor' ? `docnow://doctor/consultations/${c.id}` : `docnow://consult/room/${c.id}`;
    const text = ((): { title: string; body: string; channelId: PushChannelId; url?: string } => {
        switch (kind) {
            case 'CONFIRMED':
                return { title: 'Consultation confirmed', body: `Your consultation with ${dr} is booked for ${istDay(c.startsAt)}, ${at} IST.`, channelId: 'reminders' };
            case 'REMINDER':
                return to === 'doctor'
                    ? { title: 'Consultation in 1 hour', body: `You have a consultation at ${at} IST.`, channelId: 'reminders' }
                    : { title: 'Consultation in 1 hour', body: `With ${dr} at ${at} IST. Find a quiet spot with good network.`, channelId: 'reminders' };
            case 'JOIN_NOW':
                return to === 'doctor'
                    ? { title: 'Your consultation starts soon', body: `The ${at} room is open. Tap to open the consultation.`, channelId: 'reminders' }
                    : { title: 'Your consultation starts in 10 minutes', body: `The room is open. Tap to join ${dr}.`, channelId: 'reminders' };
            case 'PARTNER_WAITING':
                return to === 'doctor'
                    ? { title: 'Your patient is waiting', body: `Your ${at} patient has joined the room.`, channelId: 'teleconsult-call' }
                    : { title: `${dr} is waiting`, body: 'Your doctor is in the room. Tap to join now.', channelId: 'teleconsult-call' };
            case 'DOCTOR_NO_SHOW': {
                const rupees = (c.refunds.reduce((s, r) => s + r.amountPaise, 0) / 100).toFixed(2);
                return { title: 'Your doctor could not join', body: `We are sorry. A refund of Rs. ${rupees} is on its way.`, channelId: 'reminders' };
            }
            case 'PATIENT_NO_SHOW':
                return { title: 'You missed your consultation', body: `Tap to see your booking with ${dr}.`, channelId: 'reminders' };
            case 'PRESCRIPTION_ISSUED':
                return { title: 'Your prescription is ready', body: `${dr} has issued your prescription.`, channelId: 'prescriptions-reports', url: `docnow://records/prescription/${c.id}` };
        }
    })();
    const isCall = text.channelId === 'teleconsult-call';
    return {
        title: text.title,
        body: text.body,
        data: { url: text.url ?? url, channelId: text.channelId, kind, consultationId: c.id },
        channelId: text.channelId,
        sound: isCall ? CALL_SOUND : 'default',
        priority: isCall || text.channelId === 'prescriptions-reports' ? 'high' : 'normal',
        // A call alert is useless after the slot; a reminder after a few hours.
        ttl: isCall ? 15 * 60 : 6 * 3600,
        ...(isCall ? { interruptionLevel: 'time-sensitive' as const } : {}),
    };
}

type Deps = { db?: PrismaClient; now?: Date; send?: ExpoSend; consultationId?: string };

export async function sendDuePushes(deps: Deps = {}) {
    // Tests and local runs without push set EXPO_PUSH_DISABLED=1; an injected sender still runs.
    if (pushDisabled() && !deps.send) return { sent: 0, failed: 0 };
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const send = deps.send ?? sendViaExpo;

    const rows = await db.consultation.findMany({
        where: {
            status: { in: ['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW_DOCTOR', 'NO_SHOW_PATIENT', 'REFUNDED'] },
            startsAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
            ...(deps.consultationId ? { id: deps.consultationId } : {}),
        },
        select,
        orderBy: { startsAt: 'asc' },
        take: 500,
    });
    if (!rows.length) return { sent: 0, failed: 0 };

    const userIds = [...new Set(rows.flatMap((r) => [r.userId, r.doctor.userId]))];
    const tokenRows = await db.pushToken.findMany({ where: { userId: { in: userIds } }, select: { userId: true, token: true } });
    const tokensByUser = new Map<string, string[]>();
    for (const t of tokenRows) tokensByUser.set(t.userId, [...(tokensByUser.get(t.userId) ?? []), t.token]);

    let sent = 0;
    let failed = 0;
    for (const c of rows) {
        for (const [kind, to] of duePushes(c, now)) {
            const userId = to === 'doctor' ? c.doctor.userId : c.userId;
            const tokens = tokensByUser.get(userId);
            // No phone registered: nothing is claimed, so it still goes out if one registers while it is due.
            if (!tokens?.length) continue;
            if (!(await claim(db, c.id, kind, to, 'push'))) continue;
            const key = { consultationId_kind_recipient_channel: { consultationId: c.id, kind, recipient: to, channel: 'push' } };
            const message = pushMessage(kind, to, c);
            try {
                const { ticketIds, dead } = await deliverPush(db, tokens, message, send);
                // Uninstalled apps were forgotten; later sends in this run skip them too.
                if (dead.length) tokensByUser.set(userId, tokens.filter((t) => !dead.includes(t)));
                await db.consultationNotification.update({
                    where: key,
                    data: { status: 'SENT', providerId: ticketIds.join(',').slice(0, 500), lastError: null },
                });
                sent++;
            } catch (e: unknown) {
                failed++;
                const error = e instanceof Error ? e.message : String(e);
                logger.warn({ consultationId: c.id, kind, to, error }, 'consult_push_failed');
                await db.consultationNotification.update({ where: key, data: { status: 'FAILED', lastError: error.slice(0, 500) } });
            }
        }
    }
    return { sent, failed };
}

/** Sends whatever is due for one consultation now, without waiting for the next minute. Never throws. */
export function kickConsultPushes(consultationId: string) {
    sendDuePushes({ consultationId }).catch((e: unknown) =>
        logger.warn({ consultationId, error: e instanceof Error ? e.message : String(e) }, 'consult_push_kick_failed'),
    );
}
