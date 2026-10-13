/**
 * Every-minute consultation timers: settle no-shows first, then send the messages that are due,
 * so a doctor no-show notice can go out in the same run. Both steps are safe to run twice.
 */
import cron from 'node-cron';
import { Redis } from '@upstash/redis';
import { settleNoShows } from '../modules/consultations/consultations.noShow';
import { sendDueNotices } from '../modules/consultations/consultations.notifications';
import { logAlert, logger } from '../utils/logger';

export async function runConsultTimers() {
    const noShows = await settleNoShows();
    const notices = await sendDueNotices();
    if (noShows.doctors || noShows.patients || notices.sent || notices.failed) logger.info({ noShows, notices }, 'consult_timers_run');
    return { noShows, notices };
}

const redis = process.env.UPSTASH_REDIS_REST_URL
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

export function startConsultTimers() {
    logger.info({ schedule: '* * * * *' }, 'consult_timers_started');
    cron.schedule('* * * * *', async () => {
        const lockKey = 'consult-timers:lock';
        let locked = false;
        if (redis) {
            try {
                locked = !!(await redis.set(lockKey, 'locked', { nx: true, ex: 55 }));
                if (!locked) return;
            } catch (err) {
                logger.error({ error: err }, 'consult_timers_redis_lock_failed');
            }
        }
        try {
            await runConsultTimers();
        } catch (err) {
            logAlert('consult_timers_failed', { error: err });
        } finally {
            if (locked) {
                try { await redis!.del(lockKey); } catch { /* the lock expires on its own */ }
            }
        }
    });
}
