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
import { createHealthiansBooking, rollbackInitiatedBooking } from '../routes/payments';
import { assertTransition, canTransition } from '../utils/paymentStateMachine';

const INITIATED_TTL_MS = 30 * 60 * 1000;    // 30 minutes
const AUTHORIZED_STUCK_MS = 5 * 60 * 1000;  // 5 minutes
const RETRY_DELAYS = [60, 300, 900];         // seconds: 1m, 5m, 15m

/**
 * Send admin alert when a booking is dead-lettered.
 * Uses Slack webhook if configured, otherwise logs to console.
 */
async function sendDeadLetterAlert(bookingId: string, attempts: number, lastError: string) {
    const message = `🚨 *DEAD-LETTER ALERT*\nBooking \`${bookingId}\` failed after ${attempts} partner API attempts.\n*Last Error:* ${lastError}\n*Action Required:* Manual partner booking or refund needed.`;

    if (process.env.SLACK_WEBHOOK_URL) {
        try {
            await fetch(process.env.SLACK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: message })
            });
            console.log(`[DLQ] Slack alert sent for booking: ${bookingId}`);
        } catch (err) {
            console.error(`[DLQ] Failed to send Slack alert:`, err);
        }
    } else {
        console.warn(`[DLQ] SLACK_WEBHOOK_URL not configured. Alert:\n${message}`);
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
                console.log(`[Reconciler] Expired abandoned booking: ${booking.id}`);
            }
        } catch (err) {
            console.error(`[Reconciler] Failed to expire booking ${booking.id}:`, err);
        }
    }

    if (abandoned.length > 0) {
        console.log(`[Reconciler] Processed ${abandoned.length} abandoned bookings`);
    }
}

/**
 * Process stuck AUTHORIZED bookings.
 * Payment was captured but /verify never ran (user closed app).
 */
async function processStuckAuthorized() {
    const cutoff = new Date(Date.now() - AUTHORIZED_STUCK_MS);

    const stuck = await prisma.booking.findMany({
        where: {
            paymentStatus: 'AUTHORIZED',
            partnerBookingId: null,
            updatedAt: { lt: cutoff }
        },
        take: 20
    });

    for (const booking of stuck) {
        try {
            console.log(`[Reconciler] Processing stuck AUTHORIZED booking: ${booking.id}`);

            const partnerResult = await createHealthiansBooking(booking, booking.userId, booking.slotTime);

            assertTransition(booking.paymentStatus, 'CONFIRMED');
            await prisma.$transaction(async (tx) => {
                await tx.booking.update({
                    where: { id: booking.id },
                    data: {
                        paymentStatus: 'CONFIRMED',
                        partnerBookingId: partnerResult.booking_id?.toString() || null,
                        status: 'Order Booked'
                    }
                });
                await tx.cartItem.deleteMany({ where: { cart: { userId: booking.userId } } });
            });

            console.log(`[Reconciler] Booking CONFIRMED: ${booking.id}`);
        } catch (err: any) {
            console.error(`[Reconciler] Partner booking failed for ${booking.id}:`, err.message);

            assertTransition(booking.paymentStatus, 'PARTNER_FAILED');
            await prisma.booking.update({
                where: { id: booking.id },
                data: { paymentStatus: 'PARTNER_FAILED', partnerError: err.message }
            });

            // Enqueue for retry
            await prisma.partnerRetry.upsert({
                where: { bookingId: booking.id },
                create: { bookingId: booking.id, nextRetryAt: new Date(Date.now() + 60_000), lastError: err.message },
                update: {}
            });
        }
    }

    if (stuck.length > 0) {
        console.log(`[Reconciler] Processed ${stuck.length} stuck AUTHORIZED bookings`);
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
        // Skip if max retries exhausted
        if (retry.attempts >= retry.maxAttempts) {
            console.error(`[DLQ] Booking ${retry.bookingId} DEAD-LETTERED after ${retry.maxAttempts} attempts. Admin intervention required.`);

            // Step 13: Admin alerting — Slack webhook notification
            await sendDeadLetterAlert(retry.bookingId, retry.maxAttempts, retry.lastError || 'Unknown');

            // Mark as REFUNDED if that transition is valid
            if (canTransition(retry.booking.paymentStatus, 'REFUNDED')) {
                await prisma.booking.update({
                    where: { id: retry.bookingId },
                    data: { paymentStatus: 'REFUNDED' }
                });
            }
            // Remove from retry queue (it's dead)
            await prisma.partnerRetry.delete({ where: { id: retry.id } });
            continue;
        }

        try {
            console.log(`[Reconciler] Retrying partner booking (attempt ${retry.attempts + 1}/${retry.maxAttempts}): ${retry.bookingId}`);

            const partnerResult = await createHealthiansBooking(
                retry.booking, retry.booking.userId, retry.booking.slotTime
            );

            // Success → promote to CONFIRMED
            assertTransition(retry.booking.paymentStatus, 'CONFIRMED');
            await prisma.$transaction(async (tx) => {
                await tx.booking.update({
                    where: { id: retry.bookingId },
                    data: {
                        paymentStatus: 'CONFIRMED',
                        partnerBookingId: partnerResult.booking_id?.toString() || null,
                        status: 'Order Booked'
                    }
                });
                await tx.partnerRetry.delete({ where: { id: retry.id } });
                await tx.cartItem.deleteMany({ where: { cart: { userId: retry.booking.userId } } });
            });

            console.log(`[Reconciler] Retry SUCCESS — Booking CONFIRMED: ${retry.bookingId}`);
        } catch (err: any) {
            // Exponential backoff
            const nextDelay = RETRY_DELAYS[Math.min(retry.attempts, RETRY_DELAYS.length - 1)];

            await prisma.partnerRetry.update({
                where: { id: retry.id },
                data: {
                    attempts: { increment: 1 },
                    lastError: err.message,
                    nextRetryAt: new Date(Date.now() + nextDelay * 1000)
                }
            });

            console.warn(`[Reconciler] Retry FAILED (attempt ${retry.attempts + 1}), next retry in ${nextDelay}s: ${retry.bookingId}`);
        }
    }
}

/**
 * Start the reconciliation cron.
 * Schedule: every 5 minutes.
 */
export function startReconciler() {
    console.log('[Reconciler] Starting payment reconciler (every 5 min)...');

    cron.schedule('*/5 * * * *', async () => {
        const start = Date.now();
        console.log('[Reconciler] Running reconciliation cycle...');

        try {
            await expireAbandonedBookings();
            await processStuckAuthorized();
            await retryPartnerBookings();
        } catch (err) {
            console.error('[Reconciler] Unhandled error in reconciliation cycle:', err);
        }

        console.log(`[Reconciler] Cycle complete in ${Date.now() - start}ms`);
    });
}
