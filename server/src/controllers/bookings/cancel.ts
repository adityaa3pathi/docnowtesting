import { Response } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { cancelCustomerBooking } from '../../services/bookingCancellation';

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

        const schema = z.object({
            bookingId: z.string().uuid(),
            remarks: z.string().trim().min(5, 'Reason for cancellation must be at least 5 characters long'),
        });

        const parseResult = schema.safeParse({ bookingId, remarks });
        if (!parseResult.success) {
            return res.status(400).json({
                error: parseResult.error.issues[0].message,
            });
        }

        if (cancelRateLimit) {
            const { success } = await cancelRateLimit.limit(`cancel:${userId}`);
            if (!success) {
                return res.status(429).json({ error: 'Too many cancellation attempts. Please wait a minute.' });
            }
        }

        const result = await cancelCustomerBooking({
            bookingId,
            userId,
            remarks: parseResult.data.remarks,
        });

        return res.json(result);
    } catch (error: any) {
        console.error('Cancel Booking Error:', error);

        const message = error.message || 'A critical error occurred while processing cancellation';
        if (
            message.includes('not found') ||
            message.includes('access denied')
        ) {
            return res.status(404).json({ error: message });
        }
        if (
            message.includes('already cancelled') ||
            message.includes('Cancellation not allowed') ||
            message.includes('cannot be cancelled') ||
            message.includes('Partner Booking ID is missing') ||
            message.includes('No active customers found')
        ) {
            return res.status(400).json({ error: message, details: error.details });
        }

        return res.status(500).json({
            error: 'A critical error occurred while processing cancellation',
            details: error.details,
        });
    }
}
