/**
 * Consultation push notifications through Expo's push service. It uses the same due rules and the
 * same claim-before-send outbox as WhatsApp (channel "push"), so each push goes out at most once
 * per person and a failure is retried while it is still due. Runs every minute from the
 * consultation timers, and right after a join or an issued prescription so call alerts are not late.
 *
 * Payload contract with the mobile app: `data.url` is a docnow:// link the app opens on tap, and
 * `data.channelId` / `channelId` pick the Android channel (teleconsult-call rings, others do not).
 * Lock-screen text never names the patient to the doctor.
 *
 * Family bookings reach two phones: the booker's (caregiver copy, e.g. "Prescription ready for
 * Sunita Verma") and the family member's own. The family member's account is the one that accepted
 * the booking; before that, whoever signs in with the patient's phone gets generic text only, and
 * never the prescription, so a mistyped number learns nothing clinical.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { deliverPush, pushDisabled, sendViaExpo, type ExpoMessage, type ExpoSend, type PushChannelId } from '../../services/expoPush';
import { logger } from '../../utils/logger';
import { claim, dueNotices, LOOKBACK_MS, type AnyRecipient, type NoticeKind } from './consultations.notifications';
import { isSelf } from './consultations.family';

export type { ExpoMessage, ExpoSend, ExpoTicket } from '../../services/expoPush';

export type PushKind = NoticeKind | 'PRESCRIPTION_ISSUED';
type ConsultPushData = { kind: PushKind; consultationId: string };
export type ConsultPushMessage = Omit<ExpoMessage<ConsultPushData>, 'to'>;

/** Must match the file bundled by the app's expo-notifications plugin (used by iOS; Android uses the channel). */
const CALL_SOUND = 'teleconsult_call.wav';

const select = {
    id: true, status: true, startsAt: true, createdAt: true, userId: true,
    doctorJoinedAt: true, patientJoinedAt: true, familyJoinedAt: true,
    slot: { select: { endsAt: true } },
    doctor: { select: { displayName: true, userId: true } },
    refunds: { where: { reason: 'DOCTOR_NO_SHOW' }, select: { amountPaise: true } },
    prescriptions: { where: { voidedAt: null }, select: { id: true, recommendedTests: true }, take: 1 },
    patient: { select: { name: true, relation: true, phone: true, linkedUserId: true, linkDeclinedAt: true } },
    user: { select: { name: true } },
} satisfies Prisma.ConsultationSelect;
export type PushRow = Prisma.ConsultationGetPayload<{ select: typeof select }>;

const JOIN_EARLY_MS = 10 * 60_000;
const JOIN_LATE_MS = 15 * 60_000;

/** A family booking whose family member can be reached on their own phone. */
const reachesFamily = (c: PushRow) => !isSelf(c.patient.relation) && !!c.patient.phone && !c.patient.linkDeclinedAt;

/** The WhatsApp rules, plus a push once the prescription is ready, plus the family member's own pushes. */
export function duePushes(c: PushRow, now: Date): [PushKind, AnyRecipient][] {
    const due: [PushKind, AnyRecipient][] = dueNotices(c, now);
    const issued = c.prescriptions.length > 0 && (c.status === 'IN_PROGRESS' || c.status === 'COMPLETED');
    if (issued) due.push(['PRESCRIPTION_ISSUED', 'patient']);
    if (!reachesFamily(c)) return due;

    const t = now.getTime();
    const live = ['CONFIRMED', 'WAITING', 'IN_PROGRESS'].includes(c.status);
    const inWindow = t >= c.startsAt.getTime() - JOIN_EARLY_MS && t < c.slot.endsAt.getTime() + JOIN_LATE_MS;
    if (live && inWindow) {
        due.push(['JOIN_NOW', 'family']);
        // The caregiver joining does not count: the doctor is waiting for the family member.
        if (c.doctorJoinedAt && !c.familyJoinedAt) due.push(['PARTNER_WAITING', 'family']);
    }
    // Clinical news only to an account that accepted the booking.
    if (issued && c.patient.linkedUserId) due.push(['PRESCRIPTION_ISSUED', 'family']);
    return due;
}

const istTime = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toUpperCase();
const istDay = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }).format(d);

type Text = { title: string; body: string; channelId: PushChannelId; url?: string };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const hasTests = (c: PushRow) => Array.isArray(c.prescriptions[0]?.recommendedTests) && (c.prescriptions[0]!.recommendedTests as unknown[]).length > 0;

/** The family member's own phone. `linked` = they accepted the booking; otherwise keep it generic. */
function familyText(kind: PushKind, c: PushRow, dr: string): Text | null {
    const linked = !!c.patient.linkedUserId;
    const booker = c.user.name ? firstName(c.user.name) : 'your family member';
    switch (kind) {
        case 'JOIN_NOW':
            return linked
                ? { title: `${dr} will call you in 10 minutes`, body: `Booked by ${booker}. Tap to join from your phone.`, channelId: 'reminders' }
                : { title: 'Your consultation starts in 10 minutes', body: `Booked for you by ${booker} on DocNow. Tap to confirm and join.`, channelId: 'reminders' };
        case 'PARTNER_WAITING':
            return linked
                ? { title: `${dr} is waiting for you`, body: 'Tap to join the video call now.', channelId: 'teleconsult-call' }
                : { title: 'Your doctor is waiting', body: `Booked for you by ${booker}. Tap to confirm and join.`, channelId: 'teleconsult-call' };
        case 'PRESCRIPTION_ISSUED':
            return linked
                ? {
                    title: 'Your prescription is ready',
                    body: `Your prescription from ${dr} is ready${hasTests(c) ? ' with recommended tests' : ''}.`,
                    channelId: 'prescriptions-reports',
                    url: `docnow://records/prescription/${c.id}`,
                }
                : null;
        default:
            return null;
    }
}

/** The booker of a family visit: they are the caregiver, so the text is about their family member. */
function caregiverText(kind: PushKind, c: PushRow, dr: string): Text | null {
    const who = firstName(c.patient.name);
    switch (kind) {
        case 'JOIN_NOW':
            return { title: `${who}'s consultation starts in 10 minutes`, body: `Join to assist ${who} with ${dr}.`, channelId: 'reminders' };
        case 'PARTNER_WAITING':
            return { title: `${dr} is waiting`, body: `${who} has not joined yet. Tap to join and help.`, channelId: 'teleconsult-call' };
        case 'PRESCRIPTION_ISSUED':
            return {
                title: `Prescription ready for ${c.patient.name}`,
                body: `${dr} has issued it.${hasTests(c) ? ' Book the recommended tests in one tap.' : ''}`,
                channelId: 'prescriptions-reports',
                url: `docnow://records/prescription/${c.id}`,
            };
        default:
            return null;
    }
}

export function pushMessage(kind: PushKind, to: AnyRecipient, c: PushRow): ConsultPushMessage {
    const dr = `Dr. ${c.doctor.displayName}`;
    const at = istTime(c.startsAt);
    const url = to === 'doctor' ? `docnow://doctor/consultations/${c.id}` : `docnow://consult/room/${c.id}`;
    const special = to === 'family' ? familyText(kind, c, dr) : to === 'patient' && !isSelf(c.patient.relation) ? caregiverText(kind, c, dr) : null;
    const text = special ?? ((): Text => {
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

    // The family member's account: the one that accepted, else whoever signs in with that phone.
    const unlinkedPhones = [...new Set(rows.filter((r) => reachesFamily(r) && !r.patient.linkedUserId).map((r) => r.patient.phone!))];
    const phoneOwners = unlinkedPhones.length
        ? await db.user.findMany({ where: { mobile: { in: unlinkedPhones } }, select: { id: true, mobile: true } })
        : [];
    const familyUser = (r: PushRow) => r.patient.linkedUserId ?? phoneOwners.find((u) => u.mobile === r.patient.phone)?.id ?? null;

    const userIds = [...new Set(rows.flatMap((r) => [r.userId, r.doctor.userId, ...(reachesFamily(r) ? [familyUser(r)] : [])]).filter((id): id is string => !!id))];
    const tokenRows = await db.pushToken.findMany({ where: { userId: { in: userIds } }, select: { userId: true, token: true } });
    const tokensByUser = new Map<string, string[]>();
    for (const t of tokenRows) tokensByUser.set(t.userId, [...(tokensByUser.get(t.userId) ?? []), t.token]);

    let sent = 0;
    let failed = 0;
    for (const c of rows) {
        for (const [kind, to] of duePushes(c, now)) {
            const userId = to === 'doctor' ? c.doctor.userId : to === 'family' ? familyUser(c) : c.userId;
            // The booker signed in with the patient's own phone: one person, so one push is enough.
            if (!userId || (to === 'family' && userId === c.userId)) continue;
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
