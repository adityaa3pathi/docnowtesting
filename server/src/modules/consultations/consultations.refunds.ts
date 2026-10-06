/**
 * Refund records. A record is created under a lock on its payment row, sized to what is still
 * refundable, so refunds on one payment can never add up to more than was captured.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { remainingRefundable } from './consultations.money';
import type { Tx } from './consultations.transitions';

export type RefundReason = 'PATIENT_CANCEL' | 'DOCTOR_NO_SHOW' | 'LATE_PAYMENT_SLOT_LOST' | 'PAID_AFTER_CANCEL' | 'DUPLICATE_PAYMENT' | 'ADMIN' | 'EXTERNAL';

/**
 * Creates a pending refund for `requestedPaise` (or everything still refundable when omitted).
 * Returns the existing record when this payment already has one for the reason, and null when
 * nothing is left to refund. Must run inside a transaction.
 */
export async function createRefundRecord(
    tx: Tx,
    input: { consultationId: string; paymentId: string; reason: RefundReason; requestedPaise?: number },
) {
    await tx.$queryRaw`SELECT id FROM "ConsultationPayment" WHERE id = ${input.paymentId} FOR UPDATE`;
    const payment = await tx.consultationPayment.findUniqueOrThrow({ where: { id: input.paymentId } });

    const existing = await tx.consultationRefund.findUnique({ where: { paymentId_reason: { paymentId: input.paymentId, reason: input.reason } } });
    if (existing) return existing;

    const used = await tx.consultationRefund.aggregate({
        where: { paymentId: input.paymentId, status: { not: 'FAILED' } },
        _sum: { amountPaise: true },
    });
    const remaining = remainingRefundable(payment.amountPaise, used._sum.amountPaise ?? 0);
    const amountPaise = input.requestedPaise === undefined ? remaining : Math.min(input.requestedPaise, remaining);
    if (amountPaise <= 0) return null;

    return tx.consultationRefund.create({
        data: {
            consultationId: input.consultationId,
            paymentId: input.paymentId,
            reason: input.reason,
            amountPaise,
            receipt: `rf_${randomUUID().replace(/-/g, '')}`,
        } as Prisma.ConsultationRefundUncheckedCreateInput,
    });
}

export type RefundEvent = {
    razorpayRefundId: string;
    receipt?: string | null;
    razorpayPaymentId: string;
    amountPaise: number;
    status: 'created' | 'processed' | 'failed';
};

const REFUNDED_AFTER: RefundReason[] = ['PATIENT_CANCEL', 'DOCTOR_NO_SHOW'];

/** Marks a refund processed and, for cancels and no-shows, moves the consultation to refunded. */
export async function markRefundProcessed(tx: Tx, refundId: string): Promise<void> {
    const res = await tx.consultationRefund.updateMany({ where: { id: refundId, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'PROCESSED', lastError: null } });
    if (res.count !== 1) return;
    const refund = await tx.consultationRefund.findUniqueOrThrow({ where: { id: refundId } });
    if (REFUNDED_AFTER.includes(refund.reason)) {
        await tx.consultation.updateMany({
            where: { id: refund.consultationId, status: { in: ['CANCELLED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR'] } },
            data: { status: 'REFUNDED' },
        });
    }
}

/**
 * Applies a Razorpay refund event. Matches by Razorpay id, then by our receipt. A refund made by hand
 * in the dashboard is recorded as an external refund. Statuses only move forward.
 */
export async function applyRefundEvent(tx: Tx, ev: RefundEvent): Promise<'updated' | 'external' | 'unknown_payment'> {
    let refund = await tx.consultationRefund.findUnique({ where: { razorpayRefundId: ev.razorpayRefundId } });
    if (!refund && ev.receipt) refund = await tx.consultationRefund.findUnique({ where: { receipt: ev.receipt } });

    let external = false;
    if (!refund) {
        const payment = await tx.consultationPayment.findUnique({ where: { razorpayPaymentId: ev.razorpayPaymentId } });
        if (!payment) return 'unknown_payment';
        refund = await createRefundRecord(tx, { consultationId: payment.consultationId, paymentId: payment.id, reason: 'EXTERNAL', requestedPaise: ev.amountPaise });
        if (!refund) return 'unknown_payment';
        external = true;
    }

    if (!refund.razorpayRefundId) {
        await tx.consultationRefund.updateMany({ where: { id: refund.id, razorpayRefundId: null }, data: { razorpayRefundId: ev.razorpayRefundId } });
    }
    if (ev.status === 'processed') await markRefundProcessed(tx, refund.id);
    if (ev.status === 'failed') {
        await tx.consultationRefund.updateMany({ where: { id: refund.id, status: 'PENDING' }, data: { status: 'FAILED', lastError: 'Razorpay reported the refund failed' } });
    }
    return external ? 'external' : 'updated';
}
