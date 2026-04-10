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
            return res.status(400).json({ error: 'This booking link looks invalid. Please refresh and try again.' });
        }

        // 2. Rate Limiting
        if (statusRateLimit) {
            const { success } = await statusRateLimit.limit(`status:${userId}`);
            if (!success) {
                return res.status(429).json({ error: 'Please wait a moment before checking the latest update again.' });
            }
        }

        // 3. Ownership Check with details
        const booking = await BookingService.getBookingWithDetails(bookingId, userId);

        if (!booking) {
            return res.status(404).json({ error: 'We could not find this booking. Please refresh your bookings and try again.' });
        }

        const currentPartnerBookingId = booking.rescheduledToId || booking.partnerBookingId;
        const previousPartnerBookingIds =
            booking.rescheduledToId && booking.partnerBookingId && booking.rescheduledToId !== booking.partnerBookingId
                ? [booking.partnerBookingId]
                : [];
        const trackingReferenceUpdated = previousPartnerBookingIds.length > 0;

        if (!currentPartnerBookingId) {
            return res.status(400).json({ error: 'Live tracking is not available for this booking yet.' });
        }

        // 4. Call Healthians API
        const statusResponse = await healthians.getBookingStatus(currentPartnerBookingId);

        // 5. Sync status to local DB
        const healthiansStatus = statusResponse?.data?.booking_status;
        let effectiveStatus = booking.status;
        let effectivePartnerStatus = booking.partnerStatus;
        let effectiveRescheduledToId = booking.rescheduledToId;

        if (healthiansStatus) {
            const mappedStatus = resolveHealthiansStatus(healthiansStatus);
            const refBookingId = statusResponse?.data?.ref_booking_id;
            effectiveStatus = mappedStatus.docnowStatus;
            effectivePartnerStatus = healthiansStatus;
            effectiveRescheduledToId = refBookingId && refBookingId !== '0'
                ? String(refBookingId)
                : booking.rescheduledToId;

            await prisma.booking.update({
                where: { id: bookingId },
                data: {
                    status: effectiveStatus,
                    partnerStatus: healthiansStatus,
                    ...(effectiveRescheduledToId ? { rescheduledToId: effectiveRescheduledToId } : {}),
                }
            });
            console.log(`Synced booking ${bookingId} status to: ${effectiveStatus}`);
        }

        const effectiveCurrentPartnerBookingId = effectiveRescheduledToId || booking.partnerBookingId;
        const effectivePreviousPartnerBookingIds =
            effectiveRescheduledToId && booking.partnerBookingId && effectiveRescheduledToId !== booking.partnerBookingId
                ? [booking.partnerBookingId]
                : [];
        const effectiveTrackingReferenceUpdated = effectivePreviousPartnerBookingIds.length > 0;

        // 6. Build patient details map
        const patientMap = BookingService.buildPatientMap(booking);

        res.json({
            ...statusResponse,
            patientDetails: patientMap,
            lineage: {
                currentPartnerBookingId: effectiveCurrentPartnerBookingId,
                previousPartnerBookingIds: effectivePreviousPartnerBookingIds,
                trackingReferenceUpdated: effectiveTrackingReferenceUpdated,
                bookingChangeType:
                    effectiveStatus === 'Resample Required' || ['BS0018', 'BS018'].includes(effectivePartnerStatus || '')
                        ? 'RESAMPLED'
                        : effectiveStatus === 'Rescheduled' || effectivePartnerStatus === 'BS0013'
                            ? 'RESCHEDULED'
                            : 'NONE',
                bookingChangeMessage:
                    effectiveStatus === 'Resample Required' || ['BS0018', 'BS018'].includes(effectivePartnerStatus || '')
                        ? 'The lab has asked for a fresh sample collection. We will guide you through the next step.'
                        : effectivePartnerStatus === 'BS0013' || effectiveTrackingReferenceUpdated
                            ? 'We have updated your booking with the latest schedule from our lab partner.'
                            : null,
            }
        });

    } catch (error) {
        console.error('Track Status Error:', error);
        res.status(500).json({ error: 'We could not fetch the latest booking update right now. Please try again shortly.' });
    }
}
