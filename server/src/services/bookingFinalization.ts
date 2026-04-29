/**
 * ==========================================
 * BOOKING FINALIZATION SERVICE
 * ==========================================
 * 
 * This module handles the critical transition of a booking from PAID to CONFIRMED.
 * It manages distributed locking (lease) to prevent race conditions when communicating 
 * with external APIs (Healthians), and automatically triggers refunds if the partner API fails.
 */

import { PaymentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createHealthiansBooking } from './partnerBooking';
import { sendDeadLetterAlert } from '../utils/slack';
import { getRazorpay } from './razorpay';
import { prisma } from '../db';
import { logAlert, logBusinessEvent, logger } from '../utils/logger';

/**
 * Attempts to finalize a paid booking by creating it in the partner system (Healthians).
 * Uses a DB-level lease mechanism (`processingAttemptId`) to prevent multiple workers
 * from confirming the same booking simultaneously.
 * 
 * @param {string} bookingId - The internal DOCNOW booking UUID.
 * @returns {Promise<{status: string, partnerBookingId?: string, error?: string}>} The result of the finalization attempt.
 */
export async function finalizeBooking(bookingId: string) {
    const attemptId = randomUUID();

    // Layer 1: Claim Lease (AUTHORIZED, PAID, PARTNER_FAILED -> PROCESSING)
    const claimed = await prisma.booking.updateMany({
        where: {
            id: bookingId,
            paymentStatus: { in: ['AUTHORIZED', 'PAID', 'PARTNER_FAILED'] }
        },
        data: {
            paymentStatus: 'PROCESSING',
            processingAttemptId: attemptId,
            processingStartedAt: new Date()
        }
    });

    if (claimed.count === 0) {
        return { status: 'already_processing_or_confirmed' };
    }

    // Layer 2: Pre-flight check before calling Healthians
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            user: true,
            address: true,
            items: true
        }
    });

    if (!booking) {
        return { status: 'not_found' };
    }

    // Guard 1: Another actor already booked with Healthians
    if (booking.partnerBookingId) {
        logBusinessEvent('partner_booking_already_exists', {
            bookingId,
            partnerBookingId: booking.partnerBookingId,
        }, 'debug');
        await prisma.booking.updateMany({
            where: { id: bookingId, processingAttemptId: attemptId },
            data: { paymentStatus: 'CONFIRMED', processingAttemptId: null, processingStartedAt: null }
        });
        
        await syncManagerOrder(bookingId, 'CONFIRMED');
        return { status: 'already_confirmed', partnerBookingId: booking.partnerBookingId };
    }

    // Guard 2: Lease was revoked before we even called
    if (booking.processingAttemptId !== attemptId) {
        logger.warn({ bookingId, attemptId }, 'partner_booking_lease_lost_before_call');
        return { status: 'lease_lost' };
    }

    // Layer 3: Call Healthians and write back
    try {
        logBusinessEvent('partner_booking_started', { bookingId, attemptId });
        const partnerResult = await createHealthiansBooking(booking, booking.userId);
        const partnerBookingId = partnerResult.booking_id;

        const updated = await prisma.booking.updateMany({
            where: {
                id: bookingId,
                paymentStatus: 'PROCESSING',
                processingAttemptId: attemptId
            },
            data: {
                paymentStatus: 'CONFIRMED',
                partnerBookingId,
                status: 'Order Booked',
                processingAttemptId: null,
                processingStartedAt: null
            }
        });

        if (updated.count === 0) {
            logAlert('partner_booking_orphaned', {
                bookingId,
                attemptId,
                partnerBookingId,
            });
            await sendDeadLetterAlert(bookingId, attemptId, `Orphaned Healthians Booking ID: ${partnerBookingId}`);
            return { status: 'lease_lost' };
        }

        await syncManagerOrder(bookingId, 'CONFIRMED');
        logBusinessEvent('partner_booking_confirmed', {
            bookingId,
            attemptId,
            partnerBookingId,
        });
        return { status: 'success', partnerBookingId };
    } catch (error: any) {
        logAlert('partner_booking_failed', { error, bookingId, attemptId });

        // Auto Refund Logic
        let statusToSet: 'PARTNER_FAILED' | 'REFUNDED' = 'PARTNER_FAILED';
        if (booking.razorpayPaymentId) {
            try {
                // Initialize refund via Razorpay
                logBusinessEvent('refund_started', {
                    bookingId,
                    razorpayPaymentId: booking.razorpayPaymentId,
                    reason: 'partner_booking_failed',
                });
                await getRazorpay().payments.refund(booking.razorpayPaymentId, {
                    notes: {
                        reason: 'Healthians booking failed',
                        bookingId: bookingId
                    }
                });
                statusToSet = 'REFUNDED';
            } catch (refundError: any) {
                logAlert('refund_failed_manual_required', {
                    error: refundError,
                    bookingId,
                    razorpayPaymentId: booking.razorpayPaymentId,
                });
            }
        } else {
             // For zero-amount bookings or other cases where payment isn't required but failed
             statusToSet = 'REFUNDED';
        }

        const updated = await prisma.booking.updateMany({
            where: {
                id: bookingId,
                paymentStatus: 'PROCESSING',
                processingAttemptId: attemptId
            },
            data: {
                paymentStatus: statusToSet,
                status: statusToSet === 'REFUNDED' ? 'Refunded' : undefined,
                partnerError: error.message || 'Unknown Partner Error',
                processingAttemptId: null,
                processingStartedAt: null
            }
        });

        // Only create retry record if we didn't refund it successfully
        if (updated.count > 0 && statusToSet !== 'REFUNDED') {
            await prisma.partnerRetry.upsert({
                where: { bookingId },
                update: {
                    lastError: error.message || 'Unknown error',
                    nextRetryAt: new Date(Date.now() + 5 * 60 * 1000) // retry in 5 mins
                },
                create: {
                    bookingId,
                    lastError: error.message || 'Unknown error',
                    nextRetryAt: new Date(Date.now() + 5 * 60 * 1000)
                }
            });
        }

        await syncManagerOrder(bookingId, statusToSet === 'REFUNDED' ? 'REFUNDED' : 'BOOKING_FAILED');
        return { 
            status: statusToSet === 'REFUNDED' ? 'refunded_due_to_partner_error' : 'partner_failed', 
            error: error.message 
        };
    }
}

/**
 * Synchronize the ManagerOrder status with the Booking status
 */
export async function syncManagerOrder(bookingId: string, status: 'CONFIRMED' | 'BOOKING_FAILED' | 'REFUNDED') {
    const linkedManagerOrder = await prisma.managerOrder.findUnique({
        where: { bookingId }
    });

    if (linkedManagerOrder) {
        await prisma.managerOrder.update({
            where: { id: linkedManagerOrder.id },
            data: { 
                status,
                ...(status === 'REFUNDED' ? { cancelledAt: new Date() } : {})
            }
        });
    }
}
