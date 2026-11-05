/**
 * "Your lab report is ready" push. Claimed in ReportNotification before sending, so it goes out at
 * most once per report even when ingestion runs twice; a failure is retried on the next ingestion.
 * The text never names a test or result, because it can show on a locked phone.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import { deliverPush, pushDisabled, sendViaExpo, type ExpoMessage, type ExpoSend } from './expoPush';

const MAX_ATTEMPTS = 3;
const CHANNEL = 'push';

type ReportPushData = { type: 'LAB_REPORT_READY'; reportId: string };

export function reportReadyMessage(reportId: string): Omit<ExpoMessage<ReportPushData>, 'to'> {
    return {
        title: 'Your Lab Report is Ready',
        body: 'Your test results are now available to view and download.',
        data: { url: `docnow://records/report/${reportId}`, channelId: 'prescriptions-reports', type: 'LAB_REPORT_READY', reportId },
        channelId: 'prescriptions-reports',
        sound: 'default',
        priority: 'high',
        ttl: 7 * 24 * 3600,
    };
}

type Db = Pick<PrismaClient, 'pushToken' | 'reportNotification'>;

/** True when this call owns the send: a fresh claim, or a failed one taken back for retry. */
async function claim(db: Db, reportId: string): Promise<boolean> {
    try {
        await db.reportNotification.create({ data: { reportId, channel: CHANNEL } });
        return true;
    } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    const retry = await db.reportNotification.updateMany({
        where: { reportId, channel: CHANNEL, status: 'FAILED', attempts: { lt: MAX_ATTEMPTS } },
        data: { status: 'SENDING', attempts: { increment: 1 } },
    });
    return retry.count === 1;
}

export type ReportPushResult = 'sent' | 'no-devices' | 'already-sent' | 'failed' | 'disabled';

/** Sends the report-ready push to every phone of the booking's owner. Never throws. */
export async function sendReportReadyPush(
    reportId: string,
    userId: string,
    deps: { db?: Db; send?: ExpoSend } = {},
): Promise<ReportPushResult> {
    if (pushDisabled() && !deps.send) return 'disabled';
    const db = deps.db ?? prisma;
    const send = deps.send ?? sendViaExpo;
    const key = { reportId_channel: { reportId, channel: CHANNEL } };
    try {
        const tokens = (await db.pushToken.findMany({ where: { userId }, select: { token: true } })).map((t) => t.token);
        // Nothing is claimed without a phone, so a later ingestion can still notify one registered meanwhile.
        if (!tokens.length) return 'no-devices';
        if (!(await claim(db, reportId))) return 'already-sent';
        try {
            const { ticketIds } = await deliverPush(db, tokens, reportReadyMessage(reportId), send);
            await db.reportNotification.update({ where: key, data: { status: 'SENT', providerId: ticketIds.join(',').slice(0, 500), lastError: null } });
            return 'sent';
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : String(e);
            await db.reportNotification.update({ where: key, data: { status: 'FAILED', lastError: error.slice(0, 500) } });
            logger.warn({ reportId, error }, 'report_push_failed');
            return 'failed';
        }
    } catch (e: unknown) {
        logger.warn({ reportId, error: e instanceof Error ? e.message : String(e) }, 'report_push_error');
        return 'failed';
    }
}
