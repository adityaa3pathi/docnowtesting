/**
 * POST /api/webhooks/healthians
 *
 * Handles all Healthians webhook events:
 * - status_updated
 * - report_uploaded
 * - phlebo_assigned
 * - phlebo_reassigned
 *
 * Security: Shared-secret header validation (x-healthians-secret)
 * Dedup: SHA-256 of raw request body stored in WebhookEventV2.payloadHash
 * Atomicity: Single Prisma $transaction for all DB writes
 *
 * MUST be mounted BEFORE express.json() with express.raw for raw body access
 */
import crypto from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../db';
import {
    handleStatusUpdate,
    handleReportUploaded,
    handlePhleboEvent,
} from '../../services/healthiansWebhook';
import { ingestReport } from '../../services/reportIngestion';
import { logAlert, logBusinessEvent, logger } from '../../utils/logger';

interface HealthiansWebhookPayload {
    type: 'status_updated' | 'report_uploaded' | 'phlebo_assigned' | 'phlebo_reassigned';
    booking_id: string;
    data: any;
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function isValidWebhookSecret(providedSecret: string | undefined) {
    const expectedSecret = process.env.HEALTHIANS_WEBHOOK_SECRET;
    if (!expectedSecret) {
        logger.warn({}, 'healthians_webhook_secret_not_configured');
        return true;
    }

    if (!providedSecret) return false;

    const expected = Buffer.from(expectedSecret);
    const provided = Buffer.from(providedSecret);
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

export const healthiansWebhookHandler = async (req: Request, res: Response) => {
    // 1. Hash raw body BEFORE any parsing (req.body is a Buffer here)
    const rawBody = req.body as Buffer;
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

    // 2. Validate shared-secret header when configured.
    const providedSecret = getHeaderValue(req.headers['x-healthians-secret']);
    if (!isValidWebhookSecret(providedSecret)) {
        logAlert('healthians_webhook_unauthorized', { payloadHash: payloadHash.slice(0, 12) });
        return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    // 3. Parse JSON manually
    let payload: HealthiansWebhookPayload;
    try {
        payload = JSON.parse(rawBody.toString('utf-8'));
    } catch (error) {
        logger.warn({ error, payloadHash: payloadHash.slice(0, 12) }, 'healthians_webhook_malformed_json');
        return res.status(400).json({ error: 'Invalid JSON' });
    }

    const clientIp = req.ip || req.socket.remoteAddress;
    logBusinessEvent('healthians_webhook_received', {
        sourceIp: clientIp,
        eventType: payload.type,
        partnerBookingId: payload.booking_id,
        payloadHash: payloadHash.slice(0, 12),
    });

    // 4. Process inside single transaction (dedup + business logic + mark processed)
    let reportIdToIngest: string | null = null;

    try {
        await prisma.$transaction(async (tx) => {
            // Step A: Insert dedup row (processed=false)
            // If payloadHash already exists -> P2002 unique violation -> caught below
            await tx.webhookEventV2.create({
                data: {
                    payloadHash,
                    source: 'healthians',
                    eventType: payload.type,
                    bookingId: payload.booking_id,
                    rawPayload: payload as any,
                    processed: false,
                },
            });

            // Step B: Find booking by the original or current partner booking reference.
            const booking = await tx.booking.findFirst({
                where: {
                    OR: [
                        { partnerBookingId: payload.booking_id },
                        { rescheduledToId: payload.booking_id },
                    ],
                },
                include: { items: true },
            });

            if (!booking) {
                logger.warn({
                    eventType: payload.type,
                    partnerBookingId: payload.booking_id,
                    payloadHash: payloadHash.slice(0, 12),
                }, 'healthians_webhook_booking_not_found');
                await tx.webhookEventV2.update({
                    where: { payloadHash },
                    data: { processed: true },
                });
                return;
            }

            // Step C: Dispatch by event type
            switch (payload.type) {
                case 'status_updated':
                    await handleStatusUpdate(tx, booking, payload.data);
                    logBusinessEvent('healthians_status_webhook_processed', {
                        bookingId: booking.id,
                        partnerBookingId: payload.booking_id,
                        partnerStatus: payload.data?.booking_status,
                    });
                    break;

                case 'report_uploaded':
                    reportIdToIngest = await handleReportUploaded(tx, booking, payload.data);
                    logBusinessEvent('report_webhook_processed', {
                        bookingId: booking.id,
                        partnerBookingId: payload.booking_id,
                        reportId: reportIdToIngest,
                        isFullReport: payload.data?.full_report === 1,
                    });
                    break;

                case 'phlebo_assigned':
                case 'phlebo_reassigned':
                    await handlePhleboEvent(tx, booking, payload.data);
                    logBusinessEvent('phlebo_webhook_processed', {
                        bookingId: booking.id,
                        partnerBookingId: payload.booking_id,
                        eventType: payload.type,
                    });
                    break;

                default:
                    logger.warn({ eventType: payload.type, partnerBookingId: payload.booking_id }, 'healthians_webhook_unknown_event_type');
            }

            // Step D: Mark processed (inside same transaction)
            await tx.webhookEventV2.update({
                where: { payloadHash },
                data: { processed: true },
            });
        });

        // Step E: Trigger background report ingestion AFTER transaction commits
        // This runs outside the transaction so download failures don't roll back persistence
        if (reportIdToIngest) {
            ingestReport(reportIdToIngest).catch((err) =>
                logAlert('report_background_ingestion_failed', { error: err, reportId: reportIdToIngest })
            );
        }

        return res.status(200).json({ status: 'ok' });
    } catch (e: any) {
        // Duplicate detection: P2002 = unique constraint violation on payloadHash
        if (e.code === 'P2002') {
            logBusinessEvent('healthians_webhook_duplicate', { payloadHash: payloadHash.slice(0, 12) }, 'debug');
            return res.status(200).json({ status: 'duplicate' });
        }

        // All other errors: log but still return 200 to prevent Healthians retry storms
        logAlert('healthians_webhook_processing_error', { error: e, payloadHash: payloadHash.slice(0, 12) });
        return res.status(200).json({ status: 'error_logged' });
    }
};
