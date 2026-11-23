/**
 * Refund records. A record is created under a lock on its payment row, sized to what is still
 * refundable, so refunds on one payment can never add up to more than was captured. A booking paid
 * partly from the wallet has two payment rows, so its refund is two records: the card part goes
 * back through Razorpay, the wallet part straight back to the wallet.
 */
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { ConsultRazorpay, normalizeRazorpayError, RazorpayRefund, realConsultRazorpay } from './consultations.razorpay';
import { remainingRefundable } from './consultations.money';
import type { Tx } from './consultations.transitions';
import { creditWallet, walletText, WALLET_REF } from './consultations.wallet';

/** Either a client or a transaction: these helpers only use model delegates. */
export type RefundDb = Pick<Tx, 'consultationRefund' | 'consultation' | 'slot'>;
/** markRefundProcessed locks the consultation row, so it needs a transaction. */
export type RefundTx = Pick<Tx, 'consultationRefund' | 'consultation' | 'slot' | '$queryRaw'>;

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

/**
 * Marks a refund processed and, for cancels and no-shows, moves the consultation to refunded once
 * every part of its refund is processed. Must run inside a transaction: the consultation row is
 * locked first, so two parts finishing at the same moment take turns and the second one sees the first.
 */
export async function markRefundProcessed(tx: RefundTx, refundId: string): Promise<void> {
    const target = await tx.consultationRefund.findUnique({ where: { id: refundId }, select: { consultationId: true } });
    if (!target) return;
    await tx.$queryRaw`SELECT id FROM "Consultation" WHERE id = ${target.consultationId} FOR UPDATE`;
    const res = await tx.consultationRefund.updateMany({ where: { id: refundId, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'PROCESSED', lastError: null } });
    if (res.count !== 1) return;
    const refund = await tx.consultationRefund.findUniqueOrThrow({ where: { id: refundId } });
    // A two-part refund (wallet and card) is done when its last part is. A failed part is not done:
    // staff retry it, and that retry finishes the booking.
    const otherPart = await tx.consultationRefund.findFirst({
        where: { consultationId: refund.consultationId, id: { not: refund.id }, reason: { in: REFUNDED_AFTER }, status: { not: 'PROCESSED' } },
        select: { id: true },
    });
    if (REFUNDED_AFTER.includes(refund.reason) && !otherPart) {
        const c = await tx.consultation.findUniqueOrThrow({ where: { id: refund.consultationId }, select: { status: true, slotId: true } });
        const res = await tx.consultation.updateMany({
            where: { id: refund.consultationId, status: { in: ['CANCELLED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR'] } },
            data: { status: 'REFUNDED' },
        });
        // No-shows hold their slot and REFUNDED does not; a cancel already freed it.
        if (res.count === 1 && c.status !== 'CANCELLED') {
            await tx.slot.updateMany({ where: { id: c.slotId, status: 'BOOKED' }, data: { status: 'AVAILABLE' } });
        }
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

/** One status for a refund that may come in two parts (wallet and card): pending until every part is done. */
export function overallRefundStatus(refunds: { status: 'PENDING' | 'PROCESSED' | 'FAILED' }[]) {
    if (refunds.length === 0) return null;
    if (refunds.some((r) => r.status === 'PENDING')) return 'PENDING' as const;
    if (refunds.some((r) => r.status === 'FAILED')) return 'FAILED' as const;
    return 'PROCESSED' as const;
}

// ── Running a refund ────────────────────────────────────

/**
 * The wallet part: credited back in one transaction with marking the record processed. The ledger
 * row is keyed by the refund record, so a repeat (a retry, the reconciler) credits nothing twice.
 */
async function runWalletRefund(db: PrismaClient, refundId: string): Promise<'processed' | 'pending' | 'failed' | 'skipped'> {
    try {
        return await db.$transaction(async (tx) => {
            const r = await tx.consultationRefund.findUnique({ where: { id: refundId }, include: { consultation: { select: { userId: true } } } });
            if (!r || r.status !== 'PENDING') return 'skipped';
            await creditWallet(tx, r.consultation.userId, r.amountPaise, { type: WALLET_REF.REFUND, id: r.id }, walletText.refund(r.consultationId));
            await markRefundProcessed(tx, r.id);
            return 'processed';
        });
    } catch (e) {
        // Counted like a Razorpay attempt, so one that keeps failing reaches the staff queue.
        const message = e instanceof Error ? e.message.slice(0, 300) : 'Wallet refund failed';
        const after = await db.consultationRefund.update({ where: { id: refundId }, data: { attempts: { increment: 1 }, lastError: message } });
        if (after.attempts >= MAX_REFUND_ATTEMPTS) {
            await markRefundFailed(db, refundId, message, false);
            logAlert('consult_wallet_refund_failed', { refundId });
            return 'failed';
        }
        return 'pending';
    }
}

export const MAX_REFUND_ATTEMPTS = 5;

type RefundRunDeps = { db?: PrismaClient; razorpay?: ConsultRazorpay };

/**
 * Looks for a refund we may already have made, by our receipt or the record id in its notes.
 * Refunds Razorpay marked failed do not count. Returns 'unknown' when the lookup itself fails.
 */
async function findMadeRefund(razorpay: ConsultRazorpay, paymentId: string, refund: { id: string; receipt: string }) {
    try {
        const list = await razorpay.listPaymentRefunds(paymentId);
        return list.find((r) => r.status !== 'failed' && (r.receipt === refund.receipt || r.notes?.refundRecordId === refund.id)) ?? null;
    } catch {
        return 'unknown' as const;
    }
}

/**
 * Reopens a refund staff chose to retry. The failed Razorpay refund is forgotten and a new receipt
 * is used, so the runner sends a fresh one. Attempts restart at 1 so it looks for a made refund first.
 */
export async function reopenRefund(db: PrismaClient, refundId: string): Promise<boolean> {
    const res = await db.consultationRefund.updateMany({
        where: { id: refundId, OR: [{ status: 'FAILED' }, { status: 'PENDING', attempts: { gte: MAX_REFUND_ATTEMPTS } }] },
        data: { status: 'PENDING', attempts: 1, failureConfirmed: false, lastError: null, razorpayRefundId: null, receipt: `rf_${randomUUID().replace(/-/g, '')}` },
    });
    return res.count === 1;
}

async function adopt(db: PrismaClient, refundId: string, made: RazorpayRefund): Promise<'processed' | 'pending'> {
    await db.consultationRefund.updateMany({ where: { id: refundId, razorpayRefundId: null }, data: { razorpayRefundId: made.id } });
    if (made.status === 'processed') {
        await db.$transaction((tx) => markRefundProcessed(tx, refundId));
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
    if (r?.payment.source === 'WALLET') return r.attempts >= MAX_REFUND_ATTEMPTS ? 'skipped' : runWalletRefund(db, refundId);
    if (!r || r.status !== 'PENDING' || r.attempts >= MAX_REFUND_ATTEMPTS || !r.payment.razorpayPaymentId) return 'skipped';

    const claim = await db.consultationRefund.updateMany({ where: { id: r.id, status: 'PENDING', attempts: r.attempts }, data: { attempts: { increment: 1 } } });
    if (claim.count !== 1) return 'skipped';

    if (r.attempts > 0 && !r.razorpayRefundId) {
        const made = await findMadeRefund(razorpay, r.payment.razorpayPaymentId, r);
        // An earlier attempt may have sent the refund, so never send again without being able to look.
        if (made === 'unknown') return 'pending';
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
        if (made && made !== 'unknown') return adopt(db, r.id, made);
        if (r.attempts + 1 >= MAX_REFUND_ATTEMPTS) {
            await markRefundFailed(db, r.id, err.message, false);
            logAlert('consult_refund_exhausted', { refundId: r.id, reason: err.message });
            return 'failed';
        }
        await db.consultationRefund.updateMany({ where: { id: r.id }, data: { lastError: err.message } });
        return 'pending';
    }
}

/**
 * Runs the refunds just created, card parts first, so a two-part refund is marked done by its last
 * part. A failure here is left to the reconciler, which retries pending refunds.
 */
export async function runRefunds(records: { id: string; status: string; paymentId: string }[], deps: RefundRunDeps = {}) {
    const db = deps.db ?? prisma;
    const pending = records.filter((r) => r.status === 'PENDING');
    if (pending.length === 0) return;
    const wallet = new Set((await db.consultationPayment.findMany({ where: { id: { in: pending.map((r) => r.paymentId) }, source: 'WALLET' }, select: { id: true } })).map((p) => p.id));
    for (const r of [...pending.filter((r) => !wallet.has(r.paymentId)), ...pending.filter((r) => wallet.has(r.paymentId))]) {
        try {
            await runRefund(r.id, deps);
        } catch {
            logAlert('consult_refund_run_error', { refundId: r.id });
        }
    }
}
