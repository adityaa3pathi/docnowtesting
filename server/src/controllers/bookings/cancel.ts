import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { HealthiansAdapter } from '../../adapters/healthians';
import { retryWithBackoff, validationSchemas } from '../../utils/helpers';
import { BookingService } from '../../services/booking.service';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { z } from 'zod';

const healthians = HealthiansAdapter.getInstance();

// Rate limiter for cancellation
const cancelRateLimit = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(3, '1m'),
        prefix: 'ratelimit:cancel',
    }) : null;

/**
 * POST /api/bookings/:id/cancel - Cancel Booking
 */
export async function cancelBooking(req: AuthRequest, res: Response) {
    try {
        const userId = req.userId!;
        const bookingId = req.params.id as string;
        const { remarks } = req.body;

        // 1. Validation
        const schema = z.object({
            bookingId: z.string().uuid(),
            remarks: z.string().min(5, "Reason for cancellation must be at least 5 characters long")
        });

        const parseResult = schema.safeParse({ bookingId, remarks });
        if (!parseResult.success) {
            return res.status(400).json({
                error: parseResult.error.issues[0].message
            });
        }

        // 2. Rate Limiting
        if (cancelRateLimit) {
            const { success } = await cancelRateLimit.limit(`cancel:${userId}`);
            if (!success) {
                return res.status(429).json({ error: 'Too many cancellation attempts. Please wait a minute.' });
            }
        }

        // 3. Ownership Check
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, userId },
            include: { user: true }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or access denied' });
        }

        if (!booking.partnerBookingId) {
            return res.status(400).json({ error: 'Internal record error: Partner Booking ID is missing' });
        }

        // 4. Check Current Status
        if (booking.status === 'Cancelled') {
            return res.status(400).json({ error: 'This booking is already cancelled' });
        }

        const { customers, bookingStatus } = await BookingService.getHealthiansCustomers(booking.partnerBookingId);

        // Allow cancellation only if BS002 or BS005
        if (bookingStatus !== 'BS002' && bookingStatus !== 'BS005') {
            return res.status(400).json({
                error: `Cancellation not allowed. Current status is: ${bookingStatus || 'Unknown'}`
            });
        }

        if (customers.length === 0) {
            return res.status(400).json({ error: 'No active customers found to cancel' });
        }

        // 5. Process Cancellation
        const results = [];
        const failures = [];

        console.log(`Starting cancellation for booking ${booking.partnerBookingId} with ${customers.length} customers`);

        for (const customer of customers) {
            if (customer.customer_status === 'BS0018') continue;

            try {
                const cancelRes = await retryWithBackoff(() => healthians.cancelBooking({
                    booking_id: booking.partnerBookingId!,
                    vendor_billing_user_id: userId,
                    vendor_customer_id: customer.vendor_customer_id,
                    remarks: remarks || 'User requested cancellation'
                }));

                results.push({
                    customerId: customer.vendor_customer_id,
                    status: cancelRes.status,
                    message: cancelRes.message
                });
            } catch (err: any) {
                console.error(`Cancellation failed for customer ${customer.vendor_customer_id}:`, err.message);
                failures.push({
                    customerId: customer.vendor_customer_id,
                    error: 'Partner API error'
                });
            }
        }

        // 6. Update Local Database
        if (results.length > 0) {
            await prisma.booking.update({
                where: { id: bookingId },
                data: { status: 'Cancelled' }
            });

            return res.json({
                message: 'Booking cancellation processed',
                successCount: results.length,
                failureCount: failures.length,
                details: results
            });
        } else {
            return res.status(500).json({
                error: 'Failed to cancel any customers on the partner platform',
                details: failures
            });
        }

    } catch (error) {
        console.error('Cancel Booking Error:', error);
        res.status(500).json({ error: 'A critical error occurred while processing cancellation' });
    }
}
