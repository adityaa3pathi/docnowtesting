/**
 * Expo push transport shared by every notification source (consultations, lab reports).
 * Callers decide what to send and claim it in their own outbox; this sends and cleans up.
 */
import axios from 'axios';
import type { PrismaClient } from '@prisma/client';

export type PushChannelId = 'teleconsult-call' | 'prescriptions-reports' | 'reminders';

export interface ExpoMessage<D extends object = Record<string, unknown>> {
    to: string;
    title: string;
    body: string;
    /** Must carry `url` (a docnow:// link the app opens on tap) and `channelId`. */
    data: D & { url: string; channelId: PushChannelId };
    channelId: PushChannelId;
    sound: string;
    priority: 'high' | 'normal';
    ttl: number;
    interruptionLevel?: 'active' | 'time-sensitive';
}

export type ExpoTicket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };
export type ExpoSend = (messages: ExpoMessage[]) => Promise<ExpoTicket[]>;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Tests and local runs set EXPO_PUSH_DISABLED=1; callers still run when a sender is injected. */
export const pushDisabled = () => process.env.EXPO_PUSH_DISABLED === '1';

/** Sends one batch (Expo allows 100 per request); tickets come back in message order. */
export const sendViaExpo: ExpoSend = async (messages) => {
    const token = process.env.EXPO_ACCESS_TOKEN;
    const { data } = await axios.post(EXPO_PUSH_URL, messages, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        timeout: 10_000,
    });
    if (!Array.isArray(data?.data)) throw new Error(`Expo push rejected the request: ${JSON.stringify(data?.errors ?? data).slice(0, 300)}`);
    return data.data as ExpoTicket[];
};

/**
 * Sends the message to each of a person's phones and forgets phones whose app was uninstalled.
 * Returns the accepted ticket ids; throws when no phone accepted it, so the caller can retry.
 */
export async function deliverPush<D extends object>(
    db: Pick<PrismaClient, 'pushToken'>,
    tokens: string[],
    message: Omit<ExpoMessage<D>, 'to'>,
    send: ExpoSend,
): Promise<{ ticketIds: string[]; dead: string[] }> {
    const tickets = await send(tokens.map((to) => ({ to, ...message }) as ExpoMessage));
    const dead = tokens.filter((_, i) => {
        const t = tickets[i];
        return t?.status === 'error' && t.details?.error === 'DeviceNotRegistered';
    });
    if (dead.length) await db.pushToken.deleteMany({ where: { token: { in: dead } } });
    const ticketIds = tickets.flatMap((t) => (t.status === 'ok' ? [t.id] : []));
    if (!ticketIds.length) {
        const first = tickets.find((t) => t.status === 'error');
        throw new Error(first && first.status === 'error' ? first.message : 'No push ticket returned');
    }
    return { ticketIds, dead };
}
