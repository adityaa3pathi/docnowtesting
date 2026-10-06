/**
 * Payment confirmation. Verify, webhook and the job all call confirmPayment, which attaches the
 * payment to its consultation and then decides: confirm once, or create a full refund record.
 * Razorpay is never called while a row lock is held.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { verifyCheckoutSignature } from '../../utils/razorpaySignature';
import { createRefundRecord, RefundReason } from './consultations.refunds';
import { ConsultRazorpay, realConsultRazorpay } from './consultations.razorpay';
import { confirmPending, reclaimExpired, SlotLost, Tx } from './consultations.transitions';
import { OPEN_PAYMENT_STATUSES } from './consultations.types';
import { DoctorError } from './doctors.status';

export type PaymentFact = { paymentId: string; orderId: string; amountPaise: number; currency: string };
export type ConfirmOutcome = 'confirmed' | 'reclaimed' | 'already' | 'refund_created' | 'flagged' | 'unknown_order';
export type Db = PrismaClient | Tx;
export type ConfirmDeps = { db?: Db; now?: () => Date; acceptAmount?: boolean };

/** Runs in a transaction of its own, or inside the caller's when given one. */
function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return '$transaction' in db ? (db as PrismaClient).$transaction(fn) : fn(db as Tx);
}

/** Step 1, in its own short transaction: make sure a payment row carries this Razorpay payment id. */
async function attachPayment(db: Db, fact: PaymentFact) {
    const known = await db.consultationPayment.findUnique({ where: { razorpayPaymentId: fact.paymentId } });
    if (known) return known;
    const orderRow = await db.consultationPayment.findFirst({ where: { razorpayOrderId: fact.orderId }, orderBy: { createdAt: 'asc' } });
    if (!orderRow) return null;

    const claimed = await db.consultationPayment.updateMany({
        where: { id: orderRow.id, razorpayPaymentId: null },
        data: { razorpayPaymentId: fact.paymentId, status: 'CAPTURED', capturedAt: new Date(), amountPaise: fact.amountPaise },
    });
    if (claimed.count === 1) return db.consultationPayment.findUniqueOrThrow({ where: { id: orderRow.id } });

    // ON CONFLICT instead of a caught error: a failed insert would abort a surrounding transaction.
    await db.$executeRaw`
        INSERT INTO "ConsultationPayment" ("id", "consultationId", "razorpayOrderId", "razorpayPaymentId", "amountPaise", "status", "capturedAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${orderRow.consultationId}, ${fact.orderId}, ${fact.paymentId}, ${fact.amountPaise}, 'CAPTURED', now(), now())
        ON CONFLICT ("razorpayPaymentId") DO NOTHING`;
    return db.consultationPayment.findUniqueOrThrow({ where: { razorpayPaymentId: fact.paymentId } });
}

export async function confirmPayment(fact: PaymentFact, deps: ConfirmDeps = {}): Promise<ConfirmOutcome> {
    const db: Db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();

    const orderRow = await db.consultationPayment.findFirst({ where: { razorpayOrderId: fact.orderId }, include: { consultation: true } });
    if (!orderRow) return 'unknown_order';
    const expectedPaise = orderRow.consultation.feePaise;

    const payment = await attachPayment(db, fact);
    if (!payment) return 'unknown_order';

    if (!deps.acceptAmount && (fact.amountPaise !== expectedPaise || fact.currency !== 'INR')) {
        await db.consultation.updateMany({
            where: { id: payment.consultationId, status: { in: OPEN_PAYMENT_STATUSES } },
            data: { reviewReason: 'amount_mismatch' },
        });
        logAlert('consult_payment_amount_mismatch', { paymentId: fact.paymentId, orderId: fact.orderId, got: fact.amountPaise, expected: expectedPaise });
        return 'flagged';
    }

    return inTx(db, async (tx): Promise<ConfirmOutcome> => {
        const c = await tx.consultation.findUniqueOrThrow({ where: { id: payment.consultationId } });
        const refund = async (reason: RefundReason): Promise<ConfirmOutcome> => {
            await createRefundRecord(tx, { consultationId: c.id, paymentId: payment.id, reason });
            return 'refund_created';
        };

        if (c.confirmingPaymentId === fact.paymentId) return 'already';
        if (c.confirmingPaymentId) return refund('DUPLICATE_PAYMENT');

        if (c.status === 'PENDING_PAYMENT') {
            if (await confirmPending(tx, c.id, fact.paymentId)) return 'confirmed';
            const again = await tx.consultation.findUniqueOrThrow({ where: { id: c.id } });
            return again.confirmingPaymentId === fact.paymentId ? 'already' : refund('DUPLICATE_PAYMENT');
        }

        if (c.status === 'EXPIRED') {
            const doctor = await tx.doctorProfile.findUnique({ where: { id: c.doctorId }, select: { status: true } });
            const lead = (c.policySnapshot as { minLeadMinutes?: number }).minLeadMinutes ?? 0;
            const bookable = doctor?.status === 'APPROVED' && c.startsAt.getTime() > now.getTime() + lead * 60_000;
            if (!bookable) return refund('LATE_PAYMENT_SLOT_LOST');
            try {
                // A nested transaction (savepoint) so a lost slot rolls back only the re-claim, not the refund below.
                await tx.$executeRaw`SAVEPOINT reclaim`;
                await reclaimExpired(tx, c.id, c.slotId, fact.paymentId);
                await tx.$executeRaw`RELEASE SAVEPOINT reclaim`;
                return 'reclaimed';
            } catch (e) {
                if (!(e instanceof SlotLost)) throw e;
                await tx.$executeRaw`ROLLBACK TO SAVEPOINT reclaim`;
                return refund('LATE_PAYMENT_SLOT_LOST');
            }
        }

        return refund('PAID_AFTER_CANCEL');
    });
}

export type VerifyInput = { razorpay_order_id?: string; razorpay_payment_id: string; razorpay_signature: string };

/** The patient's checkout callback. Resolves the booking through the user and trusts only stored values. */
export async function verifyAndConfirm(
    userId: string,
    consultationId: string,
    body: VerifyInput,
    deps: { db?: PrismaClient; now?: () => Date; razorpay?: ConsultRazorpay } = {},
) {
    const db = deps.db ?? prisma;
    const razorpay = deps.razorpay ?? realConsultRazorpay();

    const c = await db.consultation.findFirst({
        where: { id: consultationId, userId },
        include: { payments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c || c.payments.length === 0) throw new DoctorError(404, 'Not found');
    const orderId = c.payments[0].razorpayOrderId;

    if (body.razorpay_order_id && body.razorpay_order_id !== orderId) throw new DoctorError(400, 'Order does not match this booking');
    if (!verifyCheckoutSignature(orderId, body.razorpay_payment_id, body.razorpay_signature, process.env.RAZORPAY_KEY_SECRET)) {
        throw new DoctorError(400, 'Invalid payment signature');
    }
    // A repeated tap on a payment that already confirmed this booking needs no Razorpay call.
    if (c.confirmingPaymentId === body.razorpay_payment_id) return { outcome: 'already' as const, status: c.status };

    let payment;
    try {
        payment = await razorpay.fetchPayment(body.razorpay_payment_id);
        if (payment.order_id === orderId && payment.status === 'authorized') {
            payment = await razorpay.capturePayment(payment.id, c.feePaise);
        }
    } catch {
        throw new DoctorError(502, 'Could not confirm the payment with Razorpay. It will be confirmed shortly if it went through');
    }
    if (payment.order_id !== orderId || payment.status !== 'captured') throw new DoctorError(400, 'Payment is not complete');

    const outcome = await confirmPayment(
        { paymentId: payment.id, orderId, amountPaise: payment.amount, currency: payment.currency },
        deps,
    );
    const fresh = await db.consultation.findUniqueOrThrow({ where: { id: c.id }, select: { status: true } });
    return { outcome, status: fresh.status };
}
