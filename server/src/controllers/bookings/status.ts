import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { HealthiansAdapter } from '../../adapters/healthians';
import { validationSchemas } from '../../utils/helpers';
import { BookingService } from '../../services/booking.service';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ingestReport } from '../../services/reportIngestion';
import { logger } from '../../utils/logger';

const healthians = HealthiansAdapter.getInstance();

// Rate limiter for status checks
const statusRateLimit = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(10, '1m'),
        prefix: 'ratelimit:status',
    }) : null;

import { resolveHealthiansStatus } from '../../utils/healthiansStatusMap';

const REPORT_AVAILABLE_CODES = new Set(['BS015', 'BS0015']);

/**
 * Fallback report ingestion triggered by status polling.
 * Called when Healthians status shows reports are ready but
 * the report_uploaded webhook was never received.
 *
 * For each unique patient in the booking, calls getCustomerReport_v2,
 * creates a Report row (PENDING), then fires background ingestion.
 */
async function triggerReportIngestionFallback(
    bookingId: string,
    partnerBookingId: string,
    userId: string,
    patientIds: string[],
): Promise<void> {
    // Check if any reports already exist to avoid duplicate ingestion
    const existingCount = await prisma.report.count({ where: { bookingId } });
    if (existingCount > 0) {
        logger.debug({ bookingId }, 'status_poll_report_ingestion_skipped_already_exists');
        return;
    }

    logger.warn({ bookingId, partnerBookingId }, 'status_poll_report_ingestion_fallback_triggered');

    const uniquePatientIds = [...new Set(patientIds)];
    const ingestionIds: string[] = [];

    for (const patientId of uniquePatientIds) {
        try {
            // Fetch fresh signed URL from Healthians
            const reportData = await healthians.getCustomerReport({
                booking_id: partnerBookingId,
                vendor_billing_user_id: userId,
                vendor_customer_id: patientId,
                allow_partial_report: 0, // full report only
            });

            const reportUrl = reportData?.data?.report_url?.trim();
            if (!reportUrl) {
                logger.warn({ bookingId, patientId }, 'status_poll_report_fallback_no_url');
                continue;
            }

            // Create Report row
            const report = await prisma.report.create({
                data: {
                    bookingId,
                    vendorCustomerId: patientId,
                    sourceUrl: reportUrl,
                    isFullReport: true,
                    fetchStatus: 'PENDING',
                },
            });

            ingestionIds.push(report.id);
        } catch (err: any) {
            logger.warn({ error: err, bookingId, patientId }, 'status_poll_report_fallback_patient_failed');
        }
    }

    // Fire ingestion in background — do not await
    for (const reportId of ingestionIds) {
        ingestReport(reportId).catch((err) =>
            logger.warn({ error: err, reportId, bookingId }, 'status_poll_report_ingestion_fire_failed')
        );
    }

    logger.warn({ bookingId, partnerBookingId, count: ingestionIds.length }, 'status_poll_report_ingestion_fallback_fired');
}

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

            // If reports are ready but no webhook was ever received, trigger fallback ingestion
            if (REPORT_AVAILABLE_CODES.has(healthiansStatus)) {
                const activePartnerBookingId = effectiveRescheduledToId || booking.partnerBookingId;
                const patientIds = booking.items
                    .map((item: any) => item.patient?.id)
                    .filter(Boolean) as string[];
                if (activePartnerBookingId && patientIds.length > 0) {
                    triggerReportIngestionFallback(
                        bookingId,
                        activePartnerBookingId,
                        userId,
                        patientIds,
                    ).catch((err) =>
                        logger.warn({ error: err, bookingId }, 'status_poll_report_ingestion_fallback_error')
                    );
                }
            }
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
