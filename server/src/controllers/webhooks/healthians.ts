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
import { sendPhleboAssignedViaWhatsApp } from '../../services/phleboNotifications';
import { logAlert, logBusinessEvent, logger } from '../../utils/logger';
import { addObservabilityBreadcrumb } from '../../utils/sentry';

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

// Healthians production + non-production IPs (from their infra notification)
const HEALTHIANS_ALLOWED_IPS = new Set([
    '161.118.179.139',  // Production
    '161.118.163.82',   // Non-production
    '127.0.0.1',        // Localhost (testing)
    '::1',              // Localhost IPv6
]);

function extractClientIp(req: Request): string {
    // Behind Cloudflare/Nginx, real IP is in x-forwarded-for or cf-connecting-ip
    const cfIp = getHeaderValue(req.headers['cf-connecting-ip']);
    if (cfIp) return cfIp;
    const xff = getHeaderValue(req.headers['x-forwarded-for']);
    if (xff) return xff.split(',')[0].trim();
    return req.ip || req.socket.remoteAddress || '';
}

export const healthiansWebhookHandler = async (req: Request, res: Response) => {
    // 1. Hash raw body BEFORE any parsing (req.body is a Buffer here)
    const rawBody = req.body as Buffer;
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

    // 2. Validate: shared-secret header OR IP allowlist
    const providedSecret = getHeaderValue(req.headers['x-healthians-secret']);
    const clientIp = extractClientIp(req);

    const secretValid = isValidWebhookSecret(providedSecret);
    const ipValid = HEALTHIANS_ALLOWED_IPS.has(clientIp);

    if (!secretValid && !ipValid) {
        addObservabilityBreadcrumb('healthians_webhook_unauthorized', {
            source: 'healthians',
            payloadHash: payloadHash.slice(0, 12),
            clientIp,
        });
        logAlert('healthians_webhook_unauthorized', { payloadHash: payloadHash.slice(0, 12), clientIp });
        return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    // 3. Parse JSON manually
    let payload: HealthiansWebhookPayload;
    try {
        payload = JSON.parse(rawBody.toString('utf-8'));
    } catch (error) {
        addObservabilityBreadcrumb('healthians_webhook_malformed_json', {
            source: 'healthians',
            payloadHash: payloadHash.slice(0, 12),
        });
        logger.warn({ error, payloadHash: payloadHash.slice(0, 12) }, 'healthians_webhook_malformed_json');
        return res.status(400).json({ error: 'Invalid JSON' });
    }

    addObservabilityBreadcrumb('healthians_webhook_received', {
        source: 'healthians',
        eventType: payload.type,
        partnerBookingId: payload.booking_id,
        payloadHash: payloadHash.slice(0, 12),
    });
    logBusinessEvent('healthians_webhook_received', {
        sourceIp: clientIp,
        eventType: payload.type,
        partnerBookingId: payload.booking_id,
        payloadHash: payloadHash.slice(0, 12),
    });

    // 4. Process inside single transaction (dedup + business logic + mark processed)
    let reportIdToIngest: string | null = null;
    let phleboNotification: { mobile: string; customerName: string; phleboName: string; phleboPhone: string; expectedArrival: string } | null = null;

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
            let booking = await tx.booking.findFirst({
                where: {
                    OR: [
                        { partnerBookingId: payload.booking_id },
                        { rescheduledToId: payload.booking_id },
                    ],
                },
                include: {
                    items: {
                        include: { patient: { select: { name: true } } },
                    },
                    user: { select: { name: true, mobile: true } },
                },
            });

            // Camp booking fallback: parse composite vendor_customer_id (camp:{bookingId}:{patientId})
            if (!booking && payload.data?.vendor_customer_id?.startsWith('camp:')) {
                const parts = payload.data.vendor_customer_id.split(':');
                const campBookingId = parts[1];
                if (campBookingId) {
                    booking = await tx.booking.findFirst({
                        where: { id: campBookingId },
                        include: {
                            items: {
                                include: { patient: { select: { name: true } } },
                            },
                            user: { select: { name: true, mobile: true } },
                        },
                    });
                }
            }

            // Backfill partnerBookingId on first camp webhook
            if (booking && !booking.partnerBookingId && payload.booking_id && booking.campId) {
                await tx.booking.update({
                    where: { id: booking.id },
                    data: { partnerBookingId: payload.booking_id },
                });
            }

            if (!booking) {
                addObservabilityBreadcrumb('healthians_webhook_booking_not_found', {
                    source: 'healthians',
                    eventType: payload.type,
                    partnerBookingId: payload.booking_id,
                    payloadHash: payloadHash.slice(0, 12),
                });
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
                    addObservabilityBreadcrumb('healthians_status_webhook_processing', {
                        source: 'healthians',
                        eventType: payload.type,
                        bookingId: booking.id,
                        partnerBookingId: payload.booking_id,
                    });
                    await handleStatusUpdate(tx, booking, payload.data);
                    logBusinessEvent('healthians_status_webhook_processed', {
                        bookingId: booking.id,
                        partnerBookingId: payload.booking_id,
                        partnerStatus: payload.data?.booking_status,
                    });
                    break;

                case 'report_uploaded':
                    addObservabilityBreadcrumb('healthians_report_webhook_processing', {
                        source: 'healthians',
                        eventType: payload.type,
                        bookingId: booking.id,
                        partnerBookingId: payload.booking_id,
                    });
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
                    addObservabilityBreadcrumb('healthians_phlebo_webhook_processing', {
                        source: 'healthians',
                        eventType: payload.type,
                        bookingId: booking.id,
                        partnerBookingId: payload.booking_id,
                    });
                    await handlePhleboEvent(tx, booking, payload.data);
                    logBusinessEvent('phlebo_webhook_processed', {
                        bookingId: booking.id,
                        partnerBookingId: payload.booking_id,
                        eventType: payload.type,
                    });

                    // Prepare WhatsApp notification (sent after transaction commits)
                    if (booking.user?.mobile) {
                        const patientNames = [...new Set(booking.items.map((i: any) => i.patient?.name).filter(Boolean))];
                        const customerName = patientNames.length > 0
                            ? patientNames.join(', ')
                            : (booking.user.name || 'Customer');

                        const arrivalDate = payload.data?.sample_collection_date || booking.slotDate || '';
                        const arrivalTime = payload.data?.start_time && payload.data?.end_time
                            ? `${payload.data.start_time} - ${payload.data.end_time}`
                            : booking.slotTime || '';
                        const expectedArrival = arrivalDate && arrivalTime
                            ? `${arrivalDate}, ${arrivalTime}`
                            : arrivalDate || arrivalTime || 'To be confirmed';

                        phleboNotification = {
                            mobile: booking.user.mobile,
                            customerName,
                            phleboName: payload.data?.phlebo_name || 'Phlebotomist',
                            phleboPhone: payload.data?.masked_number || 'N/A',
                            expectedArrival,
                        };
                    }
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
            addObservabilityBreadcrumb('healthians_report_ingestion_triggered', {
                source: 'healthians',
                reportId: reportIdToIngest,
                partnerBookingId: payload.booking_id,
            });
            ingestReport(reportIdToIngest).catch((err) =>
                logAlert('report_background_ingestion_failed', { error: err, reportId: reportIdToIngest })
            );
        }

        // Step F: Send phlebo assignment WhatsApp notification AFTER transaction commits
        if (phleboNotification) {
            sendPhleboAssignedViaWhatsApp(phleboNotification).then(() => {
                logBusinessEvent('phlebo_notification_sent', {
                    partnerBookingId: payload.booking_id,
                    phleboName: phleboNotification!.phleboName,
                });
            }).catch((err) =>
                logAlert('phlebo_notification_failed', { error: err, partnerBookingId: payload.booking_id })
            );
        }

        addObservabilityBreadcrumb('healthians_webhook_processed', {
            source: 'healthians',
            eventType: payload.type,
            partnerBookingId: payload.booking_id,
            payloadHash: payloadHash.slice(0, 12),
        });
        return res.status(200).json({ status: 'ok' });
    } catch (e: any) {
        // Duplicate detection: P2002 = unique constraint violation on payloadHash
        if (e.code === 'P2002') {
            addObservabilityBreadcrumb('healthians_webhook_duplicate', {
                source: 'healthians',
                eventType: payload.type,
                partnerBookingId: payload.booking_id,
                payloadHash: payloadHash.slice(0, 12),
            });
            logBusinessEvent('healthians_webhook_duplicate', { payloadHash: payloadHash.slice(0, 12) }, 'debug');
            return res.status(200).json({ status: 'duplicate' });
        }

        // All other errors: log but still return 200 to prevent Healthians retry storms
        addObservabilityBreadcrumb('healthians_webhook_processing_error', {
            source: 'healthians',
            eventType: payload.type,
            partnerBookingId: payload.booking_id,
            payloadHash: payloadHash.slice(0, 12),
        });
        logAlert('healthians_webhook_processing_error', { error: e, payloadHash: payloadHash.slice(0, 12) });
        return res.status(200).json({ status: 'error_logged' });
    }
};
