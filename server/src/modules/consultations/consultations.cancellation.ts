/**
 * Cancellation. The refund comes from the rules copied at booking, the server clock and the
 * amount paid. Status, slot and refund record change in one transaction; Razorpay is called after.
 */
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { refundForPercent } from './consultations.money';
import { pickRefundPercent, Rules } from './consultations.policy';
import { ConsultRazorpay } from './consultations.razorpay';
import { createRefundRecord, runRefund } from './consultations.refunds';
import { releaseSlot } from './consultations.transitions';
import { DoctorError } from './doctors.status';

export type CancelActor = { kind: 'booker'; userId: string } | { kind: 'admin'; adminId: string };
export type CancelDeps = { db?: PrismaClient; razorpay?: ConsultRazorpay; now?: () => Date };

const CANCELLABLE = ['CONFIRMED', 'RESCHEDULED', 'WAITING'] as const;
const MAX_REASON = 200;

export function cleanReason(reason: string | undefined): string | null {
    if (reason === undefined || reason === '') return null;
    const text = reason.trim();
    if (text.length > MAX_REASON) throw new DoctorError(400, `Reason must be at most ${MAX_REASON} characters`);
    if (/[\u0000-\u001f\u007f]/.test(text)) throw new DoctorError(400, 'Reason must be plain text');
    return text || null;
}

async function view(db: PrismaClient, id: string) {
    const c = await db.consultation.findUniqueOrThrow({ where: { id }, include: { refunds: true } });
    const refund = c.refunds.find((r) => r.reason === 'PATIENT_CANCEL' || r.reason === 'ADMIN') ?? null;
    return { status: c.status, refundPaise: refund?.amountPaise ?? 0, refundStatus: refund?.status ?? null };
}

export async function cancelConsultation(consultationId: string, actor: CancelActor, rawReason: string | undefined, deps: CancelDeps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    const reason = cleanReason(rawReason);
    const cancelledBy = actor.kind === 'booker' ? `user:${actor.userId}` : `admin:${actor.adminId}`;

    const c = await db.consultation.findFirst({
        where: actor.kind === 'booker' ? { id: consultationId, userId: actor.userId } : { id: consultationId },
        include: { payments: true },
    });
    if (!c) throw new DoctorError(404, 'Not found');

    if (c.status === 'PENDING_PAYMENT') {
        await db.$transaction(async (tx) => {
            const res = await tx.consultation.updateMany({
                where: { id: c.id, status: 'PENDING_PAYMENT' },
                data: { status: 'CANCELLED', cancelledBy, cancelReason: reason, cancelledAt: now },
            });
            if (res.count === 1) await releaseSlot(tx, c.slotId);
        });
        return view(db, c.id);
    }

    if (!(CANCELLABLE as readonly string[]).includes(c.status)) {
        if (c.status === 'CANCELLED' || c.status === 'REFUNDED') return view(db, c.id);
        throw new DoctorError(409, 'This consultation can no longer be cancelled');
    }

    const payment = c.payments.find((p) => p.razorpayPaymentId && p.razorpayPaymentId === c.confirmingPaymentId);
    if (!payment) throw new DoctorError(409, 'No confirmed payment found for this consultation');

    const rules = c.policySnapshot as unknown as Rules;
    const hoursBefore = (c.startsAt.getTime() - now.getTime()) / 3_600_000;
    const refundPaise = refundForPercent(payment.amountPaise, pickRefundPercent(rules.refundTiers, hoursBefore));

    const record = await db.$transaction(async (tx) => {
        const res = await tx.consultation.updateMany({
            where: { id: c.id, status: { in: [...CANCELLABLE] } },
            data: { status: 'CANCELLED', cancelledBy, cancelReason: reason, cancelledAt: now },
        });
        if (res.count !== 1) return null;
        await releaseSlot(tx, c.slotId);
        if (refundPaise <= 0) return null;
        return createRefundRecord(tx, {
            consultationId: c.id,
            paymentId: payment.id,
            reason: actor.kind === 'admin' ? 'ADMIN' : 'PATIENT_CANCEL',
            requestedPaise: refundPaise,
        });
    });

    if (record && record.status === 'PENDING') {
        try {
            await runRefund(record.id, { db, razorpay: deps.razorpay });
        } catch (e) {
            logAlert('consult_refund_run_error', { refundId: record.id });
        }
    }
    return view(db, c.id);
}
