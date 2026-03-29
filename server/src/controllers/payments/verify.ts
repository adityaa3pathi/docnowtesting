import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getRazorpay } from '../../services/razorpay';
import { createHealthiansBooking } from '../../services/partnerBooking';
import { rollbackInitiatedBooking } from '../../services/rollback';
import { assertTransition } from '../../utils/paymentStateMachine';
import { tryAwardFirstOrderBonus } from '../../utils/referralService';
import crypto from 'crypto';

/**
 * POST /api/payments/verify
 * Verifies payment signature and creates partner booking
 */
export const verifyPayment = async (req: AuthRequest, res: Response) => {
    const { bookingId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.userId!;

    if (!bookingId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing required payment parameters' });
    }

    try {
        // 1. Fetch booking with ownership check
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, userId },
            include: {
                promoCode: true,
                user: { include: { wallet: true } },
                items: { include: { patient: true } }
            }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // 2. Idempotency: Only return early if truly CONFIRMED
        if (booking.paymentStatus === 'CONFIRMED') {
            return res.json({ status: 'confirmed', message: 'Payment already verified' });
        }

        // 3. If AUTHORIZED (webhook arrived first), skip signature/amount checks
        const alreadyAuthorized = booking.paymentStatus === 'AUTHORIZED';

        if (!alreadyAuthorized) {
            // 4. Replay prevention
            if (booking.razorpayPaymentId) {
                return res.status(400).json({ error: 'Payment already processed for this booking' });
            }

            // 5. Verify signature (CRITICAL SECURITY CHECK)
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

            if (expectedSignature !== razorpay_signature) {
                console.error('[Payments] SECURITY: Signature mismatch for booking:', bookingId);
                assertTransition(booking.paymentStatus, 'FAILED');
                await prisma.booking.update({
                    where: { id: bookingId },
                    data: { paymentStatus: 'FAILED' }
                });
                await rollbackInitiatedBooking(booking);
                return res.status(400).json({ error: 'Payment verification failed' });
            }

            // 6. Re-fetch order from Razorpay to verify amount
            const rzpOrder = await getRazorpay().orders.fetch(razorpay_order_id);

            // 7. Verify Amount (Critical)
            const paidAmount = rzpOrder.amount_paid ? Number(rzpOrder.amount_paid) / 100 : Number(rzpOrder.amount) / 100;
            if (Math.abs(paidAmount - booking.finalAmount) > 1) {
                console.error(`[Payments] Amount mismatch: Paid ${paidAmount}, Expected ${booking.finalAmount}`);
                assertTransition(booking.paymentStatus, 'FAILED');
                await prisma.booking.update({
                    where: { id: bookingId },
                    data: { paymentStatus: 'FAILED' }
                });
                await rollbackInitiatedBooking(booking);
                return res.status(400).json({ error: 'Amount mismatch' });
            }

            // Notes check: warn only
            if (rzpOrder.notes?.bookingId && rzpOrder.notes.bookingId !== bookingId) {
                console.warn('[Payments] WARN: Booking ID mismatch in order notes. Expected:', bookingId, 'Got:', rzpOrder.notes.bookingId);
            }

            // 8. Mark as AUTHORIZED
            assertTransition(booking.paymentStatus, 'AUTHORIZED');
            await prisma.booking.update({
                where: { id: bookingId },
                data: {
                    paymentStatus: 'AUTHORIZED',
                    razorpayPaymentId: razorpay_payment_id,
                    paidAt: new Date()
                }
            });

            console.log('[Payments] Payment AUTHORIZED for booking:', bookingId);
        } else {
            console.log('[Payments] Booking already AUTHORIZED (webhook arrived first), proceeding to partner booking:', bookingId);
        }

        // 9. Try to create partner booking
        try {
            const partnerResult = await createHealthiansBooking(booking, userId, booking.slotTime);

            // Success - update to CONFIRMED in transaction
            const currentStatus = alreadyAuthorized ? 'AUTHORIZED' : 'AUTHORIZED';
            assertTransition(currentStatus as any, 'CONFIRMED');
            await prisma.$transaction(async (tx) => {
                await tx.booking.update({
                    where: { id: bookingId },
                    data: {
                        paymentStatus: 'CONFIRMED',
                        partnerBookingId: partnerResult.booking_id?.toString() || null,
                        status: 'Order Booked'
                    }
                });

                // Clear cart
                await tx.cartItem.deleteMany({ where: { cart: { userId } } });
            });

            console.log('[Payments] Booking CONFIRMED:', bookingId);

            tryAwardFirstOrderBonus(userId, bookingId).catch(err =>
                console.error('[Payments] First-order referral bonus failed:', err.message)
            );

            return res.json({ status: 'confirmed', bookingId });

        } catch (partnerError: any) {
            // Partner failed - payment is secure, enqueue for retry
            console.error('[Payments] Partner booking failed:', partnerError.message);

            assertTransition('AUTHORIZED' as any, 'PARTNER_FAILED');
            await prisma.booking.update({
                where: { id: bookingId },
                data: {
                    paymentStatus: 'PARTNER_FAILED',
                    partnerError: partnerError.message || 'Healthians API failed'
                }
            });

            await prisma.partnerRetry.upsert({
                where: { bookingId },
                create: { bookingId, nextRetryAt: new Date(Date.now() + 60_000), lastError: partnerError.message },
                update: {}
            });

            return res.status(200).json({
                status: 'payment_received_booking_pending',
                bookingId,
                message: 'Payment received. Your booking is being processed and you will receive confirmation shortly.'
            });
        }

    } catch (error) {
        console.error('[Payments] Verify error:', error);
        res.status(500).json({ error: 'Payment verification failed' });
    }
};
