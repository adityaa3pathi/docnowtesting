/**
 * Consultation side of the shared Razorpay webhook. The lab handler calls tryHandleConsultEvent
 * right after verifying the signature and before it writes its own dedupe row. An event is
 * recorded and applied in one transaction, so a failure leaves nothing behind and the retry works.
 */
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { confirmPayment } from './consultations.payments';
import { applyRefundEvent } from './consultations.refunds';

type Entities = {
    payment?: any;
    order?: any;
    refund?: any;
};

export type ConsultWebhookResult = { handled: false } | { handled: true; status: number; body: Record<string, unknown> };

function entities(payload: any): Entities {
    const p = payload?.payload ?? {};
    return { payment: p.payment?.entity, order: p.order?.entity, refund: p.refund?.entity };
}

const isConsultNote = (notes: any) => !!notes && (notes.kind === 'consult' || !!notes.consultationId);

/** The consult event is ours when notes say so, or any id on it exists in a consultation table. */
async function belongsToConsultations(db: PrismaClient, e: Entities): Promise<{ ours: boolean; marked: boolean }> {
    const marked = isConsultNote(e.order?.notes) || isConsultNote(e.payment?.notes) || isConsultNote(e.refund?.notes);
    const orderId = e.order?.id ?? e.payment?.order_id;
    const paymentId = e.payment?.id ?? e.refund?.payment_id;
    const hit =
        (orderId && (await db.consultationPayment.findFirst({ where: { razorpayOrderId: orderId }, select: { id: true } }))) ||
        (paymentId && (await db.consultationPayment.findUnique({ where: { razorpayPaymentId: paymentId }, select: { id: true } }))) ||
        (e.refund?.id && (await db.consultationRefund.findUnique({ where: { razorpayRefundId: e.refund.id }, select: { id: true } }))) ||
        (e.refund?.receipt && (await db.consultationRefund.findUnique({ where: { receipt: e.refund.receipt }, select: { id: true } })));
    return { ours: marked || !!hit, marked };
}

/** Only event type, ids, amounts and status are stored, never payer contact or card details. */
function redact(event: string, e: Entities) {
    return {
        event,
        paymentId: e.payment?.id ?? null,
        orderId: e.order?.id ?? e.payment?.order_id ?? null,
        refundId: e.refund?.id ?? null,
        amount: e.payment?.amount ?? e.refund?.amount ?? null,
        status: e.payment?.status ?? e.refund?.status ?? null,
        currency: e.payment?.currency ?? null,
    };
}

export async function tryHandleConsultEvent(payload: any, eventIdHeader: string | undefined, db: PrismaClient = prisma): Promise<ConsultWebhookResult> {
    const event: string = payload?.event ?? '';
    const e = entities(payload);
    const { ours, marked } = await belongsToConsultations(db, e);
    if (!ours) return { handled: false };

    const eventId = eventIdHeader || payload?.event_id || payload?.id;
    if (!eventId) return { handled: true, status: 400, body: { error: 'event_id missing' } };
    const key = `consult:${eventId}`;

    const outcome = await db.$transaction(async (tx) => {
        const row = await tx.webhookEventV2.upsert({
            where: { payloadHash: key },
            create: { payloadHash: key, source: 'razorpay_consult', eventType: event, rawPayload: redact(event, e) },
            update: {},
        });
        if (row.processed) return 'duplicate';

        let result = 'ignored';
        const payment = e.payment;
        if ((event === 'payment.captured' || event === 'order.paid') && payment?.status === 'captured') {
            const confirmed = await confirmPayment(
                { paymentId: payment.id, orderId: payment.order_id, amountPaise: payment.amount, currency: payment.currency },
                { db: tx },
            );
            result = confirmed;
        } else if (event.startsWith('refund.') && e.refund) {
            const status = event.endsWith('processed') ? 'processed' : event.endsWith('failed') ? 'failed' : 'created';
            result = await applyRefundEvent(tx, {
                razorpayRefundId: e.refund.id,
                receipt: e.refund.receipt,
                razorpayPaymentId: e.refund.payment_id,
                amountPaise: e.refund.amount,
                status,
            });
        }
        await tx.webhookEventV2.update({ where: { id: row.id }, data: { processed: true } });
        return result;
    });

    if (outcome === 'unknown_order' || outcome === 'unknown_payment') {
        logAlert('consult_webhook_unknown_id', { event, eventId, marked });
    }
    if (outcome === 'external') logAlert('consult_refund_external', { event, eventId });
    if (outcome === 'flagged') logAlert('consult_webhook_payment_flagged', { event, eventId });
    return { handled: true, status: 200, body: { status: outcome === 'duplicate' ? 'duplicate' : 'ok' } };
}
