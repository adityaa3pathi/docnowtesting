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

interface HealthiansWebhookPayload {
    type: 'status_updated' | 'report_uploaded' | 'phlebo_assigned' | 'phlebo_reassigned';
    booking_id: string;
    data: any;
}

export const healthiansWebhookHandler = async (req: Request, res: Response) => {
    // 1. Hash raw body BEFORE any parsing (req.body is a Buffer here)
    const rawBody = req.body as Buffer;
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

    // 2. Parse JSON manually
    let payload: HealthiansWebhookPayload;
    try {
        payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
        console.error('[HealthiansWebhook] Malformed JSON received');
        return res.status(400).json({ error: 'Invalid JSON' });
    }

    // 3. Shared-secret validation (fail-closed)
    if (!process.env.HEALTHIANS_WEBHOOK_SECRET) {
        console.error('[HealthiansWebhook] HEALTHIANS_WEBHOOK_SECRET not configured. Rejecting all requests.');
        return res.status(503).json({ error: 'Webhook endpoint not configured' });
    }

    const secret = req.headers['x-healthians-secret'] as string | undefined;
    if (secret !== process.env.HEALTHIANS_WEBHOOK_SECRET) {
        console.warn(`[HealthiansWebhook] Invalid or missing secret. Hash: ${payloadHash.slice(0, 12)}...`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(
        `[HealthiansWebhook] Received: type=${payload.type} ` +
        `booking_id=${payload.booking_id} hash=${payloadHash.slice(0, 12)}...`
    );

    // 4. Process inside single transaction (dedup + business logic + mark processed)
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

            // Step B: Find booking by partnerBookingId
            const booking = await tx.booking.findFirst({
                where: { partnerBookingId: payload.booking_id },
                include: { items: true },
            });

            if (!booking) {
                console.warn(
                    `[HealthiansWebhook] No booking found for partner ID: ${payload.booking_id}. ` +
                    `Marking processed (no action needed).`
                );
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
                    break;

                case 'report_uploaded':
                    await handleReportUploaded(tx, booking, payload.data);
                    break;

                case 'phlebo_assigned':
                case 'phlebo_reassigned':
                    await handlePhleboEvent(tx, booking, payload.data);
                    break;

                default:
                    console.warn(`[HealthiansWebhook] Unknown event type: ${payload.type}`);
            }

            // Step D: Mark processed (inside same transaction)
            await tx.webhookEventV2.update({
                where: { payloadHash },
                data: { processed: true },
            });
        });

        return res.status(200).json({ status: 'ok' });
    } catch (e: any) {
        // Duplicate detection: P2002 = unique constraint violation on payloadHash
        if (e.code === 'P2002') {
            console.log(`[HealthiansWebhook] Duplicate event ignored: ${payloadHash.slice(0, 12)}...`);
            return res.status(200).json({ status: 'duplicate' });
        }

        // All other errors: log but still return 200 to prevent Healthians retry storms
        console.error(`[HealthiansWebhook] Processing error:`, e);
        return res.status(200).json({ status: 'error_logged' });
    }
};
