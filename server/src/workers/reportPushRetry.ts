/**
 * Retries "Your Lab Report is Ready" pushes that failed (Expo down, network). Every 5 minutes,
 * with backoff, up to the 3 attempts sendReportReadyPush allows. A row left SENDING by a crash
 * mid-send is taken back too, so a push is never silently lost; in that rare case the person
 * may get it twice, which is better than never.
 */
import cron from 'node-cron';
import { Redis } from '@upstash/redis';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { sendReportReadyPush } from '../services/reportPush';
import { logAlert, logger } from '../utils/logger';

/** Wait this long after the last attempt per attempt made: 5 min after the first, 10 after the second. */
export const RETRY_BACKOFF_MS = 5 * 60_000;
/** A send never takes this long; a row still SENDING after it was abandoned. */
export const STALE_SENDING_MS = 15 * 60_000;
/** The push lives a week on Expo; retrying an older report would arrive out of context. */
export const RETRY_WINDOW_MS = 7 * 24 * 3_600_000;
const MAX_ATTEMPTS = 3;

type Deps = { db?: PrismaClient; now?: Date; send?: typeof sendReportReadyPush };

export async function retryFailedReportPushes(deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const send = deps.send ?? sendReportReadyPush;

    const stale = await db.reportNotification.updateMany({
        where: { channel: 'push', status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
        data: { status: 'FAILED', lastError: 'Abandoned while sending' },
    });

    const rows = await db.reportNotification.findMany({
        where: {
            channel: 'push',
            status: 'FAILED',
            attempts: { lt: MAX_ATTEMPTS },
            createdAt: { gt: new Date(now.getTime() - RETRY_WINDOW_MS) },
            updatedAt: { lt: new Date(now.getTime() - RETRY_BACKOFF_MS) },
        },
        select: { reportId: true, attempts: true, updatedAt: true, report: { select: { booking: { select: { userId: true } } } } },
        orderBy: { updatedAt: 'asc' },
        take: 100,
    });

    let sent = 0;
    let failed = 0;
    for (const r of rows) {
        if (now.getTime() - r.updatedAt.getTime() < RETRY_BACKOFF_MS * r.attempts) continue;
        // sendReportReadyPush re-claims the FAILED row itself, so two overlapping runs cannot both send.
        const result = await send(r.reportId, r.report.booking.userId);
        if (result === 'sent') sent++;
        else if (result === 'failed') failed++;
    }
    return { recovered: stale.count, retried: sent + failed, sent, failed };
}

const redis = process.env.UPSTASH_REDIS_REST_URL
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

export function startReportPushRetry() {
    logger.info({ schedule: '*/5 * * * *' }, 'report_push_retry_started');
    cron.schedule('*/5 * * * *', async () => {
        const lockKey = 'report-push-retry:lock';
        let locked = false;
        if (redis) {
            try {
                locked = !!(await redis.set(lockKey, 'locked', { nx: true, ex: 240 }));
                if (!locked) return;
            } catch (err) {
                logger.error({ error: err }, 'report_push_retry_redis_lock_failed');
            }
        }
        try {
            const out = await retryFailedReportPushes();
            if (out.recovered || out.retried) logger.info(out, 'report_push_retry_run');
        } catch (err) {
            logAlert('report_push_retry_failed', { error: err });
        } finally {
            if (locked) {
                try { await redis!.del(lockKey); } catch { /* the lock expires on its own */ }
            }
        }
    });
}
