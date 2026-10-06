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
