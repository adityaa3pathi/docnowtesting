import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getRazorpay } from '../../services/razorpay';
import { rollbackInitiatedBooking } from '../../services/rollback';
import { assertTransition } from '../../utils/paymentStateMachine';
import { tryAwardFirstOrderBonus } from '../../utils/referralService';
import { finalizeBooking } from '../../services/bookingFinalization';
import crypto from 'crypto';
import { logAlert, logBusinessEvent, logger } from '../../utils/logger';

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
                logAlert('razorpay_payment_signature_mismatch', {
                    bookingId,
                    razorpayOrderId: razorpay_order_id,
                    razorpayPaymentId: razorpay_payment_id,
                });
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
                logAlert('razorpay_payment_amount_mismatch', {
                    bookingId,
                    paidAmount,
                    expectedAmount: booking.finalAmount,
                    razorpayOrderId: razorpay_order_id,
                });
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
                logger.warn({
                    bookingId,
                    notesBookingId: rzpOrder.notes.bookingId,
                    razorpayOrderId: razorpay_order_id,
                }, 'razorpay_order_notes_booking_mismatch');
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

            logBusinessEvent('payment_authorized', {
                bookingId,
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id,
                source: 'verify',
            });
        } else {
            logBusinessEvent('payment_already_authorized', { bookingId, source: 'verify' }, 'debug');
        }

        // 9. Finalize booking safely through lease mechanism
        const result = await finalizeBooking(bookingId);

        if (result.status === 'success' || result.status === 'already_confirmed') {
            // Clear cart
            await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
            logBusinessEvent('partner_booking_confirmed', {
                bookingId,
                source: 'verify',
                resultStatus: result.status,
            });

            tryAwardFirstOrderBonus(userId, bookingId).catch(err =>
                logger.warn({ error: err, bookingId }, 'first_order_referral_bonus_failed')
            );

            return res.json({ status: 'confirmed', bookingId });
        } else if (result.status === 'refunded_due_to_partner_error') {
            // Clear cart as payment was processed and booking inherently failed
            await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
            logAlert('partner_booking_failed_refund_started', { bookingId });
            return res.status(200).json({
                status: 'refunded_due_to_partner_error',
                bookingId,
                message: 'Payment received but partner booking failed. An automated refund has been initiated.'
            });
        } else {
            logger.warn({ bookingId, resultStatus: result.status }, 'partner_booking_pending_after_payment');
            return res.status(200).json({
                status: 'payment_received_booking_pending',
                bookingId,
                message: 'Payment received. Your booking is being processed and you will receive confirmation shortly.'
            });
        }

    } catch (error) {
        logger.error({ error, bookingId }, 'payment_verify_failed');
        res.status(500).json({ error: 'Payment verification failed' });
    }
};
