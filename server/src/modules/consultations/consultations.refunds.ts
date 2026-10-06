/**
 * Refund records. A record is created under a lock on its payment row, sized to what is still
 * refundable, so refunds on one payment can never add up to more than was captured.
 */
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { ConsultRazorpay, normalizeRazorpayError, RazorpayRefund, realConsultRazorpay } from './consultations.razorpay';
import { remainingRefundable } from './consultations.money';
import type { Tx } from './consultations.transitions';

/** Either a client or a transaction: these helpers only use model delegates. */
export type RefundDb = Pick<Tx, 'consultationRefund' | 'consultation'>;

export type RefundReason = 'PATIENT_CANCEL' | 'DOCTOR_NO_SHOW' | 'LATE_PAYMENT_SLOT_LOST' | 'PAID_AFTER_CANCEL' | 'DUPLICATE_PAYMENT' | 'ADMIN' | 'EXTERNAL';

/**
 * Creates a pending refund for `requestedPaise`, or everything still refundable when omitted.
 * Returns the existing record for this payment and reason, or null when nothing is left to refund.
 * Must run inside a transaction.
 */
export async function createRefundRecord(
    tx: Tx,
    input: { consultationId: string; paymentId: string; reason: RefundReason; requestedPaise?: number },
) {
    const [payment] = await tx.$queryRaw<{ amountPaise: number }[]>`SELECT "amountPaise" FROM "ConsultationPayment" WHERE id = ${input.paymentId} FOR UPDATE`;
    if (!payment) throw new Error('Payment not found');

    const existing = await tx.consultationRefund.findUnique({ where: { paymentId_reason: { paymentId: input.paymentId, reason: input.reason } } });
    if (existing) return existing;

    const used = await tx.consultationRefund.aggregate({
        where: { paymentId: input.paymentId, NOT: { status: 'FAILED', failureConfirmed: true } },
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
export async function markRefundProcessed(tx: RefundDb, refundId: string): Promise<void> {
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

/** Marks a pending refund failed. `confirmed` is true only when Razorpay itself reported the failure. */
export async function markRefundFailed(db: RefundDb, refundId: string, lastError: string, confirmed: boolean): Promise<void> {
    await db.consultationRefund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'FAILED', failureConfirmed: confirmed, lastError } });
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
        await markRefundFailed(tx, refund.id, 'Razorpay reported the refund failed', true);
    }
    return external ? 'external' : 'updated';
}

// ── Running a refund at Razorpay ────────────────────────

export const MAX_REFUND_ATTEMPTS = 5;

type RefundRunDeps = { db?: PrismaClient; razorpay?: ConsultRazorpay };

/** Looks for a refund we may already have made, by our receipt or the record id in its notes. */
async function findMadeRefund(razorpay: ConsultRazorpay, paymentId: string, refund: { id: string; receipt: string }) {
    try {
        const list = await razorpay.listPaymentRefunds(paymentId);
        return list.find((r) => r.receipt === refund.receipt || r.notes?.refundRecordId === refund.id) ?? null;
    } catch {
        return null;
    }
}

async function adopt(db: PrismaClient, refundId: string, made: RazorpayRefund): Promise<'processed' | 'pending'> {
    await db.consultationRefund.updateMany({ where: { id: refundId, razorpayRefundId: null }, data: { razorpayRefundId: made.id } });
    if (made.status === 'processed') {
        await markRefundProcessed(db, refundId);
        return 'processed';
    }
    return 'pending';
}

/**
 * Sends one pending refund to Razorpay. No lock is held during the call. A claim on the attempt
 * counter keeps two runners from sending the same refund, and a retry first looks for a refund
 * that an earlier timed-out attempt may have made.
 */
export async function runRefund(refundId: string, deps: RefundRunDeps = {}): Promise<'processed' | 'pending' | 'failed' | 'skipped'> {
    const db = deps.db ?? prisma;
    const razorpay = deps.razorpay ?? realConsultRazorpay();

    const r = await db.consultationRefund.findUnique({ where: { id: refundId }, include: { payment: true } });
    if (!r || r.status !== 'PENDING' || r.attempts >= MAX_REFUND_ATTEMPTS || !r.payment.razorpayPaymentId) return 'skipped';

    const claim = await db.consultationRefund.updateMany({ where: { id: r.id, status: 'PENDING', attempts: r.attempts }, data: { attempts: { increment: 1 } } });
    if (claim.count !== 1) return 'skipped';

    if (r.attempts > 0 && !r.razorpayRefundId) {
        const made = await findMadeRefund(razorpay, r.payment.razorpayPaymentId, r);
        if (made) return adopt(db, r.id, made);
    }
    if (r.razorpayRefundId) return 'pending';

    try {
        const made = await razorpay.createRefund({
            paymentId: r.payment.razorpayPaymentId,
            amountPaise: r.amountPaise,
            receipt: r.receipt,
            notes: { refundRecordId: r.id, consultationId: r.consultationId, reason: r.reason },
        });
        return await adopt(db, r.id, made);
    } catch (e) {
        const err = normalizeRazorpayError(e);
        if (err.kind === 'api' && err.status && err.status >= 400 && err.status < 500) {
            await markRefundFailed(db, r.id, err.message, true);
            logAlert('consult_refund_failed', { refundId: r.id, reason: err.message });
            return 'failed';
        }
        const made = await findMadeRefund(razorpay, r.payment.razorpayPaymentId, r);
        if (made) return adopt(db, r.id, made);
        if (r.attempts + 1 >= MAX_REFUND_ATTEMPTS) {
            await markRefundFailed(db, r.id, err.message, false);
            logAlert('consult_refund_exhausted', { refundId: r.id, reason: err.message });
            return 'failed';
        }
        await db.consultationRefund.updateMany({ where: { id: r.id }, data: { lastError: err.message } });
        return 'pending';
    }
}
