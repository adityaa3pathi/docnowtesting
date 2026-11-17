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
import { createRefundRecord, runRefund, type RefundReason } from './consultations.refunds';
import { isDoctorLate } from './consultations.room';
import { releaseSlot } from './consultations.transitions';
import { DoctorError } from './doctors.status';

export type CancelActor = { kind: 'booker'; userId: string } | { kind: 'admin'; adminId: string };
export type CancelDeps = { db?: PrismaClient; razorpay?: ConsultRazorpay; now?: () => Date };

const CANCELLABLE = ['CONFIRMED', 'RESCHEDULED', 'WAITING'] as const;
const MAX_REASON = 200;

/**
 * Reasons that blame the doctor. They refund in full, bypassing the tiers, but only when the server
 * itself sees the doctor late (isDoctorLate); otherwise the cancel is refused, never silently tiered.
 */
export const DOCTOR_FAULT_REASONS = ['DOCTOR_LATE', 'DOCTOR_NO_SHOW'] as const;
export const DOCTOR_NOT_LATE = 'Your doctor is not late, so this is not a doctor-delay cancellation. Cancel normally to see your refund.';
const isDoctorFault = (reason: string | null) => (DOCTOR_FAULT_REASONS as readonly string[]).includes(reason ?? '');

export function cleanReason(reason: string | undefined): string | null {
    if (reason === undefined || reason === '') return null;
    const text = reason.trim();
    if (text.length > MAX_REASON) throw new DoctorError(400, `Reason must be at most ${MAX_REASON} characters`);
    if (/[\u0000-\u001f\u007f]/.test(text)) throw new DoctorError(400, 'Reason must be plain text');
    return text || null;
}

async function view(db: PrismaClient, id: string) {
    const c = await db.consultation.findUniqueOrThrow({ where: { id }, include: { refunds: true } });
    const refund = c.refunds.find((r) => r.reason === 'PATIENT_CANCEL' || r.reason === 'ADMIN' || r.reason === 'DOCTOR_NO_SHOW') ?? null;
    return { status: c.status, refundPaise: refund?.amountPaise ?? 0, refundStatus: refund?.status ?? null };
}

/** The refund for cancelling now, from the rules copied at booking and the server clock. */
export function estimateRefund(c: { startsAt: Date; policySnapshot: unknown }, paidPaise: number, now: Date) {
    const rules = c.policySnapshot as Rules;
    const hoursBefore = (c.startsAt.getTime() - now.getTime()) / 3_600_000;
    const percent = pickRefundPercent(rules.refundTiers, hoursBefore);
    return { percent, refundPaise: refundForPercent(paidPaise, percent) };
}

/** What cancelling would refund right now. The real cancel uses the same estimate. */
export async function cancelPreview(userId: string, consultationId: string, deps: CancelDeps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    const c = await db.consultation.findFirst({ where: { id: consultationId, userId }, include: { payments: true } });
    if (!c) throw new DoctorError(404, 'Not found');
    if (c.status === 'PENDING_PAYMENT') return { percent: 0, refundPaise: 0, paidPaise: 0 };
    if (!(CANCELLABLE as readonly string[]).includes(c.status)) throw new DoctorError(409, 'This consultation can no longer be cancelled');
    const payment = c.payments.find((p) => p.razorpayPaymentId && p.razorpayPaymentId === c.confirmingPaymentId);
    if (!payment) throw new DoctorError(409, 'No confirmed payment found for this consultation');
    return { ...estimateRefund(c, payment.amountPaise, now), paidPaise: payment.amountPaise };
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

    const doctorFault = isDoctorFault(reason);
    if (doctorFault && !isDoctorLate(c, now)) throw new DoctorError(409, DOCTOR_NOT_LATE);

    const payment = c.payments.find((p) => p.razorpayPaymentId && p.razorpayPaymentId === c.confirmingPaymentId);
    if (!payment) throw new DoctorError(409, 'No confirmed payment found for this consultation');

    // The doctor's delay is not the patient's fault: everything paid comes back, whatever the tiers say.
    const refundPaise = doctorFault ? payment.amountPaise : estimateRefund(c, payment.amountPaise, now).refundPaise;
    const refundReason: RefundReason = doctorFault ? 'DOCTOR_NO_SHOW' : actor.kind === 'admin' ? 'ADMIN' : 'PATIENT_CANCEL';

    const record = await db.$transaction(async (tx) => {
        const res = await tx.consultation.updateMany({
            // A doctor who joins in the same instant is no longer late; the full refund is then not owed.
            where: { id: c.id, status: { in: [...CANCELLABLE] }, ...(doctorFault ? { doctorJoinedAt: null } : {}) },
            data: { status: 'CANCELLED', cancelledBy, cancelReason: reason, cancelledAt: now },
        });
        if (res.count !== 1) return null;
        await releaseSlot(tx, c.slotId);
        if (refundPaise <= 0) return null;
        return createRefundRecord(tx, {
            consultationId: c.id,
            paymentId: payment.id,
            reason: refundReason,
            requestedPaise: refundPaise,
        });
    });

    if (doctorFault && !record) {
        const after = await db.consultation.findUniqueOrThrow({ where: { id: c.id }, select: { status: true } });
        if (after.status !== 'CANCELLED' && after.status !== 'REFUNDED') {
            throw new DoctorError(409, 'Your doctor has just joined. Please refresh to join the call.');
        }
    }
    if (doctorFault && record) logAlert('consult_doctor_late', { consultationId: c.id, doctorId: c.doctorId, outcome: 'refunded' });
    if (record && record.status === 'PENDING') {
        try {
            await runRefund(record.id, { db, razorpay: deps.razorpay });
        } catch (e) {
            logAlert('consult_refund_run_error', { refundId: record.id });
        }
    }
    return view(db, c.id);
}
