import { Request, Response } from 'express';
import Razorpay from 'razorpay';
import { prisma } from '../../db';
import { createHealthiansBooking } from '../../services/partnerBooking';
import { rollbackInitiatedBooking } from '../../services/rollback';
import { assertTransition } from '../../utils/paymentStateMachine';
import { tryAwardFirstOrderBonus } from '../../utils/referralService';

/**
 * POST /api/payments/webhook
 * Handles Razorpay webhooks (backup for verify)
 * NOTE: This must be mounted BEFORE express.json()
 */
export const webhookHandler = async (req: Request, res: Response) => {
    const signature = req.headers['x-razorpay-signature'] as string;

    if (!signature) {
        return res.status(401).json({ error: 'Missing signature' });
    }

    // 1. Verify webhook signature (using raw body)
    const isValid = Razorpay.validateWebhookSignature(
        req.body.toString(),
        signature,
        process.env.RAZORPAY_WEBHOOK_SECRET!
    );

    if (!isValid) {
        console.error('[Webhook] Invalid signature');
        return res.status(401).end();
    }

    const payload = JSON.parse(req.body.toString());
    console.log('[Webhook] Full Payload:', JSON.stringify(payload, null, 2));

    // Prioritize header for event ID, fall back to payload
    const eventId = (req.headers['x-razorpay-event-id'] as string) || payload.event_id || payload.id;
    const event = payload.event;

    if (!eventId) {
        console.error('[Webhook] Error: x-razorpay-event-id header missing in headers and payload');
        return res.status(400).json({ error: 'event_id missing' });
    }

    console.log('[Webhook] Received:', event, eventId);

    // 2. Dedup check using WebhookEvent
    try {
        await prisma.webhookEvent.create({
            data: { eventId }
        });
    } catch (e: any) {
        if (e.code === 'P2002') {  // Unique constraint violation
            console.log('[Webhook] Duplicate event ignored:', eventId);
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
            console.log('[Webhook] Processing payment for booking:', booking.id);
            assertTransition(booking.paymentStatus, 'AUTHORIZED');
            await prisma.booking.update({
                where: { id: booking.id },
                data: {
                    paymentStatus: 'AUTHORIZED',
                    razorpayPaymentId: payment.id,
                    paidAt: new Date()
                }
            });

            // Delayed partner booking fallback (60s timeout)
            const bookingIdForDelay = booking.id;
            const userIdForDelay = booking.userId;
            setTimeout(async () => {
                try {
                    const freshBooking = await prisma.booking.findUnique({
                        where: { id: bookingIdForDelay },
                        include: { items: { include: { patient: true } } }
                    });
                    if (freshBooking && freshBooking.paymentStatus === 'AUTHORIZED' && !freshBooking.partnerBookingId) {
                        console.log('[Webhook] /verify did not complete, triggering partner booking for:', bookingIdForDelay);

                        const partnerResult = await createHealthiansBooking(freshBooking, userIdForDelay, freshBooking.slotTime);

                        assertTransition('AUTHORIZED' as any, 'CONFIRMED');
                        await prisma.$transaction(async (tx) => {
                            await tx.booking.update({
                                where: { id: bookingIdForDelay },
                                data: {
                                    paymentStatus: 'CONFIRMED',
                                    partnerBookingId: partnerResult.booking_id?.toString() || null,
                                    status: 'Order Booked'
                                }
                            });
                            await tx.cartItem.deleteMany({ where: { cart: { userId: userIdForDelay } } });
                        });
                        console.log('[Webhook] Delayed partner booking SUCCESS:', bookingIdForDelay);

                        tryAwardFirstOrderBonus(userIdForDelay, bookingIdForDelay).catch(err =>
                            console.error('[Webhook] First-order referral bonus failed:', err.message)
                        );
                    }
                } catch (delayErr: any) {
                    console.error('[Webhook] Delayed partner booking failed:', delayErr.message);
                }
            }, 60_000);
        }
    } else if (event === 'payment.failed') {
        const booking = await prisma.booking.findFirst({
            where: { razorpayOrderId: orderId }
        });

        if (booking && booking.paymentStatus === 'INITIATED') {
            console.log('[Webhook] Payment failed for booking:', booking.id);
            assertTransition(booking.paymentStatus, 'FAILED');
            await prisma.booking.update({
                where: { id: booking.id },
                data: { paymentStatus: 'FAILED' }
            });
            await rollbackInitiatedBooking(booking);
        }
    }

    res.status(200).json({ status: 'ok' });
};
