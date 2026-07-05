import { Request, Response } from 'express';
import Razorpay from 'razorpay';
import { prisma } from '../../db';
import { finalizeBooking } from '../../services/bookingFinalization';
import { rollbackInitiatedBooking } from '../../services/rollback';
import { assertTransition } from '../../utils/paymentStateMachine';
import { tryAwardFirstOrderBonus } from '../../utils/referralService';
import { logAlert, logBusinessEvent, logger } from '../../utils/logger';
import { addObservabilityBreadcrumb } from '../../utils/sentry';

/**
 * POST /api/payments/webhook
 * Handles Razorpay webhooks (backup for verify)
 * NOTE: This must be mounted BEFORE express.json()
 */
export const webhookHandler = async (req: Request, res: Response) => {
    const signature = req.headers['x-razorpay-signature'] as string;

    if (!signature) {
        addObservabilityBreadcrumb('razorpay_webhook_missing_signature');
        return res.status(401).json({ error: 'Missing signature' });
    }

    // 1. Verify webhook signature (using raw body)
    const isValid = Razorpay.validateWebhookSignature(
        req.body.toString(),
        signature,
        process.env.RAZORPAY_WEBHOOK_SECRET!
    );

    if (!isValid) {
        addObservabilityBreadcrumb('razorpay_webhook_invalid_signature');
        logAlert('razorpay_webhook_invalid_signature');
        return res.status(401).end();
    }

    const payload = JSON.parse(req.body.toString());

    // Prioritize header for event ID, fall back to payload
    const eventId = (req.headers['x-razorpay-event-id'] as string) || payload.event_id || payload.id;
    const event = payload.event;

    if (!eventId) {
        addObservabilityBreadcrumb('razorpay_webhook_missing_event_id', { event });
        logger.warn({ event }, 'razorpay_webhook_missing_event_id');
        return res.status(400).json({ error: 'event_id missing' });
    }

    addObservabilityBreadcrumb('razorpay_webhook_received', { eventId, event, source: 'razorpay' });
    logBusinessEvent('razorpay_webhook_received', { eventId, event });

    // 2. Dedup check using WebhookEvent
    try {
        await prisma.webhookEvent.create({
            data: { eventId }
        });
    } catch (e: any) {
        if (e.code === 'P2002') {  // Unique constraint violation
            addObservabilityBreadcrumb('razorpay_webhook_duplicate', { eventId, event, source: 'razorpay' });
            logBusinessEvent('razorpay_webhook_duplicate', { eventId, event }, 'debug');
            return res.status(200).json({ status: 'duplicate' });
        }
        throw e;
    }

    // 3. Process event
    const payment = payload.payload.payment.entity;
    const orderId = payment.order_id;

    if (event === 'payment.captured') {
        const booking = await prisma.booking.findFirst({
            where: { razorpayOrderId: orderId }
        });

        if (booking && booking.paymentStatus === 'INITIATED') {
            addObservabilityBreadcrumb('razorpay_payment_captured_processing', {
                bookingId: booking.id,
                eventId,
                source: 'razorpay',
            });
            assertTransition(booking.paymentStatus, 'AUTHORIZED');
            await prisma.booking.update({
                where: { id: booking.id },
                data: {
                    paymentStatus: 'AUTHORIZED',
                    razorpayPaymentId: payment.id,
                    paidAt: new Date()
                }
            });
            logBusinessEvent('payment_authorized', {
                bookingId: booking.id,
                razorpayOrderId: orderId,
                razorpayPaymentId: payment.id,
                source: 'webhook',
            });

            // Delayed partner booking fallback (60s timeout)
            const bookingIdForDelay = booking.id;
            const userIdForDelay = booking.userId;
            setTimeout(async () => {
                try {
                    const freshBooking = await prisma.booking.findUnique({
                        where: { id: bookingIdForDelay }
                    });
                    if (freshBooking && freshBooking.paymentStatus === 'AUTHORIZED' && !freshBooking.partnerBookingId) {
                        logBusinessEvent('payment_verify_fallback_started', { bookingId: bookingIdForDelay });

                        const result = await finalizeBooking(bookingIdForDelay);
                        
                        if (result.status === 'success' || result.status === 'already_confirmed') {
                            await prisma.cartItem.deleteMany({ where: { cart: { userId: userIdForDelay } } });
                            logBusinessEvent('partner_booking_confirmed', {
                                bookingId: bookingIdForDelay,
                                source: 'webhook_fallback',
                            });

                            tryAwardFirstOrderBonus(userIdForDelay, bookingIdForDelay).catch(err =>
                                logger.warn({ error: err, bookingId: bookingIdForDelay }, 'first_order_referral_bonus_failed')
                            );
                        }
                    }
                } catch (delayErr: any) {
                    logAlert('payment_verify_fallback_failed', { error: delayErr, bookingId: bookingIdForDelay });
                }
            }, 60_000);
        }
    } else if (event === 'payment.failed') {
        const booking = await prisma.booking.findFirst({
            where: { razorpayOrderId: orderId }
        });

        if (booking && booking.paymentStatus === 'INITIATED') {
            addObservabilityBreadcrumb('razorpay_payment_failed_processing', {
                bookingId: booking.id,
                eventId,
                source: 'razorpay',
            });
            assertTransition(booking.paymentStatus, 'FAILED');
            await prisma.booking.update({
                where: { id: booking.id },
                data: { paymentStatus: 'FAILED' }
            });
            await rollbackInitiatedBooking(booking);
            logBusinessEvent('payment_failed', {
                bookingId: booking.id,
                razorpayOrderId: orderId,
                source: 'webhook',
            }, 'warn');
        }
    } else if (event === 'payment_link.paid') {
        const plink = payload.payload.payment_link?.entity;
        const managerOrderId = plink?.notes?.managerOrderId;
        const bookingId = plink?.notes?.bookingId;
        const razorpayPaymentId = payload.payload.payment?.entity?.id;

        if (managerOrderId && bookingId) {
            addObservabilityBreadcrumb('razorpay_payment_link_paid_processing', {
                bookingId,
                managerOrderId,
                eventId,
                source: 'razorpay',
            });

            // Mark payment received and authorize the booking
            await prisma.managerOrder.updateMany({
                where: { id: managerOrderId, status: 'SENT' },
                data: { status: 'PAYMENT_RECEIVED' }
            });

            await prisma.booking.update({
                where: { id: bookingId },
                data: { 
                    razorpayPaymentId: razorpayPaymentId,
                    paymentStatus: 'AUTHORIZED',
                    paidAt: new Date()
                }
            });

            logBusinessEvent('manager_payment_link_paid', {
                bookingId,
                managerOrderId,
                razorpayPaymentId,
            });

            // Auto-confirm: finalize booking with partner (Healthians)
            try {
                const result = await finalizeBooking(bookingId);

                if (result.status === 'success' || result.status === 'already_confirmed') {
                    await prisma.managerOrder.update({
                        where: { id: managerOrderId },
                        data: { 
                            status: 'CONFIRMED',
                            collectionMode: 'RAZORPAY_LINK',
                            confirmedAt: new Date()
                        }
                    });

                    // Fetch order to get customerId for cart cleanup
                    const order = await prisma.managerOrder.findUnique({ where: { id: managerOrderId } });
                    if (order?.customerId) {
                        await prisma.cartItem.deleteMany({ where: { cart: { userId: order.customerId } } });
                    }

                    logBusinessEvent('manager_payment_link_auto_confirmed', {
                        bookingId,
                        managerOrderId,
                        source: 'webhook_auto',
                    });
                } else {
                    // Partner booking failed — mark for manual retry
                    await prisma.managerOrder.update({
                        where: { id: managerOrderId },
                        data: { status: 'BOOKING_FAILED' }
                    });
                    logAlert('manager_payment_link_auto_confirm_partner_failed', {
                        bookingId,
                        managerOrderId,
                        result,
                    });
                }
            } catch (autoErr: any) {
                logAlert('manager_payment_link_auto_confirm_error', {
                    bookingId,
                    managerOrderId,
                    error: autoErr.message,
                });
            }
        }
    }

    addObservabilityBreadcrumb('razorpay_webhook_processed', { eventId, event, source: 'razorpay' });
    res.status(200).json({ status: 'ok' });
};
