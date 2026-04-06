import { PrismaClient, PaymentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createHealthiansBooking } from './partnerBooking';
import { sendDeadLetterAlert } from '../utils/slack';

const prisma = new PrismaClient();

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
        console.warn(`[Finalization] Booking ${bookingId} already has partnerBookingId=${booking.partnerBookingId}. Skipping Healthians call.`);
        await prisma.booking.updateMany({
            where: { id: bookingId, processingAttemptId: attemptId },
            data: { paymentStatus: 'CONFIRMED', processingAttemptId: null, processingStartedAt: null }
        });
        
        await syncManagerOrder(bookingId, 'CONFIRMED');
        return { status: 'already_confirmed', partnerBookingId: booking.partnerBookingId };
    }

    // Guard 2: Lease was revoked before we even called
    if (booking.processingAttemptId !== attemptId) {
        console.warn(`[Finalization] Lease revoked before partner call for ${bookingId}. Aborting.`);
        return { status: 'lease_lost' };
    }

    // Layer 3: Call Healthians and write back
    try {
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
            console.error(
                `🚨 [ORPHAN ALERT] Lease lost for booking ${bookingId}, attempt ${attemptId}. ` +
                `Healthians booking ${partnerBookingId} was created but cannot be saved. ` +
                `Manual cancellation required on Healthians dashboard.`
            );
            await sendDeadLetterAlert(bookingId, attemptId, `Orphaned Healthians Booking ID: ${partnerBookingId}`);
            return { status: 'lease_lost' };
        }

        await syncManagerOrder(bookingId, 'CONFIRMED');
        return { status: 'success', partnerBookingId };
    } catch (error: any) {
        console.error(`[Finalization] Healthians failure for booking ${bookingId}:`, error.message);

        const updated = await prisma.booking.updateMany({
            where: {
                id: bookingId,
                paymentStatus: 'PROCESSING',
                processingAttemptId: attemptId
            },
            data: {
                paymentStatus: 'PARTNER_FAILED',
                partnerError: error.message || 'Unknown Partner Error',
                processingAttemptId: null,
                processingStartedAt: null
            }
        });

        if (updated.count > 0) {
            // Only create retry record if we still owned the lease and updated successfully
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

        await syncManagerOrder(bookingId, 'BOOKING_FAILED');
        return { status: 'partner_failed', error: error.message };
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
