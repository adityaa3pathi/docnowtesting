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

import { resolveHealthiansStatus } from '../../utils/healthiansStatusMap';

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

        const currentPartnerBookingId = booking.rescheduledToId || booking.partnerBookingId;
        const previousPartnerBookingIds =
            booking.rescheduledToId && booking.partnerBookingId && booking.rescheduledToId !== booking.partnerBookingId
                ? [booking.partnerBookingId]
                : [];
        const trackingReferenceUpdated = previousPartnerBookingIds.length > 0;

        if (!currentPartnerBookingId) {
            return res.status(400).json({ error: 'Partner Booking ID missing for this order' });
        }

        // 4. Call Healthians API
        const statusResponse = await healthians.getBookingStatus(currentPartnerBookingId);

        // 5. Sync status to local DB
        const healthiansStatus = statusResponse?.data?.booking_status;
        if (healthiansStatus) {
            const mappedStatus = resolveHealthiansStatus(healthiansStatus);
            const refBookingId = statusResponse?.data?.ref_booking_id;
            await prisma.booking.update({
                where: { id: bookingId },
                data: {
                    status: mappedStatus.docnowStatus,
                    partnerStatus: healthiansStatus,
                    ...(refBookingId && refBookingId !== '0' ? { rescheduledToId: String(refBookingId) } : {}),
                }
            });
            console.log(`Synced booking ${bookingId} status to: ${mappedStatus.docnowStatus}`);
        }

        // 6. Build patient details map
        const patientMap = BookingService.buildPatientMap(booking);

        res.json({
            ...statusResponse,
            patientDetails: patientMap,
            lineage: {
                currentPartnerBookingId,
                previousPartnerBookingIds,
                trackingReferenceUpdated,
                bookingChangeType:
                    booking.status === 'Resample Required' || ['BS0018', 'BS018'].includes(booking.partnerStatus || '')
                        ? 'RESAMPLED'
                        : booking.status === 'Rescheduled' || booking.partnerStatus === 'BS0013'
                            ? 'RESCHEDULED'
                            : 'NONE',
                bookingChangeMessage:
                    booking.status === 'Resample Required' || ['BS0018', 'BS018'].includes(booking.partnerStatus || '')
                        ? 'The lab has asked for a fresh sample collection. We will guide you through the next step.'
                        : booking.partnerStatus === 'BS0013' || trackingReferenceUpdated
                            ? 'We have updated your booking with the latest schedule from our lab partner.'
                            : null,
            }
        });

    } catch (error) {
        console.error('Track Status Error:', error);
        res.status(500).json({ error: 'Failed to fetch booking status' });
    }
}
