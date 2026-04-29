/**
 * Reconciliation Worker
 * 
 * Runs every 5 minutes to self-heal the payment system:
 * 1. Expire abandoned INITIATED bookings (>30 min) → rollback wallet/promo
 * 2. Process stuck AUTHORIZED bookings (>5 min, no partner booking) → create partner booking
 * 3. Retry PARTNER_FAILED bookings via PartnerRetry table (exponential backoff)
 */
import cron from 'node-cron';
import { prisma } from '../db';
import { createHealthiansBooking } from '../services/partnerBooking';
import { rollbackInitiatedBooking } from '../services/rollback';
import { assertTransition, canTransition } from '../utils/paymentStateMachine';
import { sendDeadLetterAlert } from '../utils/slack';
import { finalizeBooking, syncManagerOrder } from '../services/bookingFinalization';
import { Redis } from '@upstash/redis';
import { logAlert, logBusinessEvent, logger } from '../utils/logger';

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null;

const INITIATED_TTL_MS = 30 * 60 * 1000;    // 30 minutes
const AUTHORIZED_STUCK_MS = 5 * 60 * 1000;  // 5 minutes
const RETRY_DELAYS = [60, 300, 900];         // seconds: 1m, 5m, 15m
const PROCESSING_LEASE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Release stale PROCESSING leases back to PARTNER_FAILED.
 */
async function recoverStuckProcessing() {
    const cutoff = new Date(Date.now() - PROCESSING_LEASE_TTL_MS);

    const stuck = await prisma.booking.updateMany({
        where: {
            paymentStatus: 'PROCESSING',
            processingStartedAt: { lt: cutoff }
        },
        data: {
            paymentStatus: 'PARTNER_FAILED',
            processingAttemptId: null,
            processingStartedAt: null
        }
    });

    if (stuck.count > 0) {
        logBusinessEvent('reconciler_stale_processing_released', { count: stuck.count }, 'warn');
    }
}

/**
 * Expire abandoned INITIATED bookings.
 * User started checkout but never paid → wallet & promo stay locked.
 */
async function expireAbandonedBookings() {
    const cutoff = new Date(Date.now() - INITIATED_TTL_MS);

    const abandoned = await prisma.booking.findMany({
        where: {
            paymentStatus: 'INITIATED',
            createdAt: { lt: cutoff }
        },
        take: 50 // batch to avoid overwhelming the DB
    });

    for (const booking of abandoned) {
        try {
            if (!canTransition(booking.paymentStatus, 'EXPIRED')) continue;

            assertTransition(booking.paymentStatus, 'EXPIRED');
            const result = await prisma.booking.updateMany({
                where: { id: booking.id, paymentStatus: 'INITIATED' }, // conditional update
                data: { paymentStatus: 'EXPIRED' }
            });

            if (result.count > 0) {
                await rollbackInitiatedBooking(booking);
                logBusinessEvent('booking_expired_abandoned_checkout', { bookingId: booking.id });
            }
        } catch (err) {
            logger.error({ error: err, bookingId: booking.id }, 'reconciler_expire_booking_failed');
        }
    }

    if (abandoned.length > 0) {
        logger.info({ count: abandoned.length }, 'reconciler_abandoned_bookings_processed');
    }
}

/**
 * Process stuck AUTHORIZED bookings.
 * Payment was captured but /verify never ran (user closed app).
 */
async function processStuckAuthorized() {
    const cutoff = new Date(Date.now() - AUTHORIZED_STUCK_MS);

    // Find bookings stuck in AUTHORIZED for > 5 min
    const stuck = await prisma.booking.findMany({
        where: {
            paymentStatus: 'AUTHORIZED',
            updatedAt: { lte: cutoff }
        }
    });

    for (const booking of stuck) {
        logBusinessEvent('reconciler_stuck_authorized_processing_started', { bookingId: booking.id });
        // Let finalizeBooking handle the leased claim, partner call, and retry queueing
        await finalizeBooking(booking.id);
    }

    if (stuck.length > 0) {
        logger.info({ count: stuck.length }, 'reconciler_stuck_authorized_processed');
    }
}

/**
 * Retry PARTNER_FAILED bookings with exponential backoff.
 * After max retries → dead-letter (admin must intervene).
 */
async function retryPartnerBookings() {
    const retries = await prisma.partnerRetry.findMany({
        where: {
            nextRetryAt: { lte: new Date() },
        },
        include: { booking: true },
        take: 10
    });

    for (const retry of retries) {
        // Guard: Check if it already has a partnerBookingId (from a leaked attempt)
        if (retry.booking.partnerBookingId && retry.booking.paymentStatus === 'PARTNER_FAILED') {
            logger.warn({ bookingId: retry.bookingId, partnerBookingId: retry.booking.partnerBookingId }, 'reconciler_partner_booking_exists_promoting_confirmed');
            await prisma.$transaction(async (tx) => {
                await tx.booking.update({
                    where: { id: retry.bookingId },
                    data: { paymentStatus: 'CONFIRMED', status: 'Order Booked' }
                });
                await tx.partnerRetry.delete({ where: { id: retry.id } });
            });
            await syncManagerOrder(retry.bookingId, 'CONFIRMED');
            continue;
        }

        // Skip if max retries exhausted
        if (retry.attempts >= retry.maxAttempts) {
            logAlert('partner_booking_dead_lettered', {
                bookingId: retry.bookingId,
                attempts: retry.attempts,
                maxAttempts: retry.maxAttempts,
                lastError: retry.lastError,
            });

            const linkedMO = await prisma.managerOrder.findUnique({
                where: { bookingId: retry.bookingId }
            });

            // Step 13: Admin alerting — Slack webhook notification
            await sendDeadLetterAlert(retry.bookingId, retry.maxAttempts, retry.lastError || 'Unknown');

            // Mark as REFUNDED if that transition is valid
            if (canTransition(retry.booking.paymentStatus, 'REFUNDED')) {
                if (linkedMO?.collectionMode && linkedMO.collectionMode !== 'RAZORPAY_LINK') {
                    // Offline payment — can't auto-refund. Alert admin only.
                    logger.warn({ bookingId: retry.bookingId, managerOrderId: linkedMO.id }, 'reconciler_offline_order_auto_refund_skipped');
                } else {
                    await prisma.booking.update({
                        where: { id: retry.bookingId },
                        data: { paymentStatus: 'REFUNDED' }
                    });
                    
                    if (linkedMO) {
                        await syncManagerOrder(retry.bookingId, 'REFUNDED');
                    }
                }
            }
            // Remove from retry queue (it's dead)
            await prisma.partnerRetry.delete({ where: { id: retry.id } });
            continue;
        }

        logBusinessEvent('partner_booking_retry_started', {
            bookingId: retry.bookingId,
            attempt: retry.attempts + 1,
            maxAttempts: retry.maxAttempts,
        });

        const result = await finalizeBooking(retry.bookingId);

        if (result.status === 'success') {
            logBusinessEvent('partner_booking_retry_succeeded', { bookingId: retry.bookingId });
            // finalizeBooking handles the ManagerOrder sync. We just need to clean up the retry queue.
            await prisma.partnerRetry.delete({ where: { id: retry.id } });
        } else if (result.status === 'already_confirmed') {
             await prisma.partnerRetry.delete({ where: { id: retry.id } });
        } else if (result.status === 'partner_failed') {
            // Exponential backoff
            const nextDelay = RETRY_DELAYS[Math.min(retry.attempts, RETRY_DELAYS.length - 1)];

            await prisma.partnerRetry.update({
                where: { id: retry.id },
                data: {
                    attempts: { increment: 1 },
                    lastError: result.error,
                    nextRetryAt: new Date(Date.now() + nextDelay * 1000) // seconds to ms
                }
            });

            logger.warn({
                bookingId: retry.bookingId,
                attempt: retry.attempts + 1,
                maxAttempts: retry.maxAttempts,
                nextDelaySeconds: nextDelay,
                error: result.error,
            }, 'partner_booking_retry_failed');
        }
    }
}

/**
 * Start the reconciliation cron.
 * Schedule: every 5 minutes.
 */
export function startReconciler() {
    logger.info({ schedule: '*/5 * * * *' }, 'reconciler_started');

    cron.schedule('*/5 * * * *', async () => {
        const start = Date.now();
        logger.info({}, 'reconciler_cycle_started');

        const lockKey = 'reconciler:lock';
        if (redis) {
            try {
                // Try to acquire lock for 4.5 minutes (270 seconds)
                const acquired = await redis.set(lockKey, 'locked', { nx: true, ex: 270 });
                if (!acquired) {
                    logger.info({}, 'reconciler_cycle_skipped_lock_held');
                    return;
                }
            } catch (err) {
                logger.error({ error: err }, 'reconciler_redis_lock_failed');
            }
        }

        try {
            await recoverStuckProcessing();
            await expireAbandonedBookings();
            await processStuckAuthorized();
            await retryPartnerBookings();
        } catch (err) {
            logAlert('reconciler_cycle_failed', { error: err });
        } finally {
            if (redis) {
                try { await redis.del(lockKey); } catch (e) {}
            }
        }

        logger.info({ durationMs: Date.now() - start }, 'reconciler_cycle_completed');
    });
}
