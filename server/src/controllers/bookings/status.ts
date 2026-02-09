import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { HealthiansAdapter } from '../../adapters/healthians';
import { validationSchemas } from '../../utils/helpers';
import { BookingService } from '../../services/booking.service';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const healthians = HealthiansAdapter.getInstance();

// Rate limiter for status checks
const statusRateLimit = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(10, '1m'),
        prefix: 'ratelimit:status',
    }) : null;

// Status code mapping
const STATUS_CODE_TO_LABEL: Record<string, string> = {
    'BS002': 'Order Booked',
    'BS003': 'Sample Collection Scheduled',
    'BS005': 'Sample Collector Assigned',
    'BS006': 'Sample Collected',
    'BS007': 'Report Generated',
    'BS0018': 'Cancelled',
};

/**
 * GET /api/bookings/:id/status - Track Booking Status
 */
export async function getStatus(req: AuthRequest, res: Response) {
    try {
        const userId = req.userId!;
        const bookingId = req.params.id as string;

        // 1. Validation
        const parse = validationSchemas.uuid.safeParse(bookingId);
        if (!parse.success) {
            return res.status(400).json({ error: 'Invalid Booking ID format' });
        }

        // 2. Rate Limiting
        if (statusRateLimit) {
            const { success } = await statusRateLimit.limit(`status:${userId}`);
            if (!success) {
                return res.status(429).json({ error: 'Too many status check requests' });
            }
        }

        // 3. Ownership Check with details
        const booking = await BookingService.getBookingWithDetails(bookingId, userId);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        if (!booking.partnerBookingId) {
            return res.status(400).json({ error: 'Partner Booking ID missing for this order' });
        }

        // 4. Call Healthians API
        const statusResponse = await healthians.getBookingStatus(booking.partnerBookingId);

        // 5. Sync status to local DB
        const healthiansStatus = statusResponse?.data?.booking_status;
        if (healthiansStatus && STATUS_CODE_TO_LABEL[healthiansStatus]) {
            await prisma.booking.update({
                where: { id: bookingId },
                data: { status: STATUS_CODE_TO_LABEL[healthiansStatus] }
            });
            console.log(`Synced booking ${bookingId} status to: ${STATUS_CODE_TO_LABEL[healthiansStatus]}`);
        }

        // 6. Build patient details map
        const patientMap = BookingService.buildPatientMap(booking);

        res.json({
            ...statusResponse,
            patientDetails: patientMap
        });

    } catch (error) {
        console.error('Track Status Error:', error);
        res.status(500).json({ error: 'Failed to fetch booking status' });
    }
}
