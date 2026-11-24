/**
 * Cancellation. The refund comes from the rules copied at booking, the server clock and the
 * amount paid. Status, slot and refund record change in one transaction; Razorpay is called after.
 */
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { MIN_CARD_PAISE, paidParts, refundForPercent } from './consultations.money';
import { pickRefundPercent, Rules } from './consultations.policy';
import { ConsultRazorpay } from './consultations.razorpay';
import { createRefundRecord, overallRefundStatus, runRefunds, type RefundReason } from './consultations.refunds';
import { isDoctorLate } from './consultations.room';
import { releaseSlot, reopenInstantSlots } from './consultations.transitions';
import { releaseWalletHold } from './consultations.wallet';
import { releasePromo } from './consultations.promo';
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
    const c = await db.consultation.findUniqueOrThrow({ where: { id }, include: { refunds: { include: { payment: { select: { source: true } } } } } });
    const parts = c.refunds.filter((r) => r.reason === 'PATIENT_CANCEL' || r.reason === 'ADMIN' || r.reason === 'DOCTOR_NO_SHOW');
    return {
        status: c.status,
        refundPaise: parts.reduce((sum, r) => sum + r.amountPaise, 0),
        walletRefundPaise: parts.filter((r) => r.payment.source === 'WALLET').reduce((sum, r) => sum + r.amountPaise, 0),
        refundStatus: overallRefundStatus(parts),
    };
}

/**
 * What each paid part gets back. The tier percentage applies to each part on its own, so a 50%
 * refund of ₹200 wallet + ₹300 card is ₹100 to the wallet and ₹150 to the card (Aditya, 2026-11-23).
 */
export function splitRefund<P extends { amountPaise: number; source: 'RAZORPAY' | 'WALLET' }>(parts: P[], percent: number) {
    const split = parts.map((part) => ({ part, refundPaise: refundForPercent(part.amountPaise, percent) }));
    // Razorpay cannot refund under ₹1. A card share that small goes to the wallet instead, when
    // there is a wallet part with room for it (the total is unchanged).
    const card = split.find((s) => s.part.source === 'RAZORPAY');
    const wallet = split.find((s) => s.part.source === 'WALLET');
    if (card && wallet && card.refundPaise > 0 && card.refundPaise < MIN_CARD_PAISE && wallet.part.amountPaise - wallet.refundPaise >= card.refundPaise) {
        wallet.refundPaise += card.refundPaise;
        card.refundPaise = 0;
    }
    return split;
}

type PaidPayment = { id: string; source: 'RAZORPAY' | 'WALLET'; status: string; razorpayPaymentId: string | null; amountPaise: number };

/**
 * The refund for cancelling now, from the rules copied at booking and the server clock. Hours count
 * to the earliest start the booking had (refundBasisStartsAt), so moving it later never raises the
 * refund (Aditya, 2026-11-23).
 */
export function estimateRefund(c: { startsAt: Date; refundBasisStartsAt?: Date | null; policySnapshot: unknown }, parts: { amountPaise: number; source: 'RAZORPAY' | 'WALLET' }[], now: Date) {
    const rules = c.policySnapshot as Rules;
    const basis = c.refundBasisStartsAt && c.refundBasisStartsAt < c.startsAt ? c.refundBasisStartsAt : c.startsAt;
    const hoursBefore = (basis.getTime() - now.getTime()) / 3_600_000;
    const percent = pickRefundPercent(rules.refundTiers, hoursBefore);
    const split = splitRefund(parts, percent);
    return {
        percent,
        refundPaise: split.reduce((sum, s) => sum + s.refundPaise, 0),
        walletRefundPaise: split.filter((s) => s.part.source === 'WALLET').reduce((sum, s) => sum + s.refundPaise, 0),
    };
}

function confirmedParts(c: { confirmingPaymentId: string | null; payments: PaidPayment[] }) {
    const parts = paidParts(c);
    // A booking a promo made free has nothing to refund, but can still be cancelled.
    if (parts.length === 0 && !c.confirmingPaymentId?.startsWith('free:')) throw new DoctorError(409, 'No confirmed payment found for this consultation');
    return parts;
}

/** What cancelling would refund right now. The real cancel uses the same estimate. */
export async function cancelPreview(userId: string, consultationId: string, deps: CancelDeps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    const c = await db.consultation.findFirst({ where: { id: consultationId, userId }, include: { payments: true } });
    if (!c) throw new DoctorError(404, 'Not found');
    if (c.status === 'PENDING_PAYMENT') return { percent: 0, refundPaise: 0, walletRefundPaise: 0, paidPaise: 0, walletPaidPaise: 0 };
    if (!(CANCELLABLE as readonly string[]).includes(c.status)) throw new DoctorError(409, 'This consultation can no longer be cancelled');
    const parts = confirmedParts(c);
    // The policy copied at booking, so the box shows the rules this booking is actually held to.
    const rules = c.policySnapshot as Rules;
    return {
        ...estimateRefund(c, parts, now),
        paidPaise: parts.reduce((sum, p) => sum + p.amountPaise, 0),
        walletPaidPaise: parts.filter((p) => p.source === 'WALLET').reduce((sum, p) => sum + p.amountPaise, 0),
        policy: { refundTiers: rules.refundTiers, doctorNoShowFullRefund: rules.doctorNoShowOutcome === 'FULL_REFUND' },
        // Instant consults: a full refund on any cancel, which is possible until the doctor joins.
        instant: c.isInstant,
        // Moved by the patient: the tiers count to this earlier time, and the box says so.
        refundBasisStartsAt: c.refundBasisStartsAt && c.refundBasisStartsAt < c.startsAt ? c.refundBasisStartsAt : null,
    };
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
            if (res.count === 1) {
                await releaseSlot(tx, c.slotId);
                await releaseWalletHold(tx, c.id);
                await releasePromo(tx, c.id);
                // Instant: the doctor waiting for this payment is free again at once.
                await tx.instantRequest.updateMany({ where: { consultationId: c.id, status: 'ACCEPTED' }, data: { status: 'CANCELLED', endedAt: now } });
            }
        });
        return view(db, c.id);
    }

    if (!(CANCELLABLE as readonly string[]).includes(c.status)) {
        if (c.status === 'CANCELLED' || c.status === 'REFUNDED') return view(db, c.id);
        throw new DoctorError(409, 'This consultation can no longer be cancelled');
    }

    const doctorFault = isDoctorFault(reason);
    if (doctorFault && !isDoctorLate(c, now)) throw new DoctorError(409, DOCTOR_NOT_LATE);

    const parts = confirmedParts(c);

    // The doctor's delay is not the patient's fault: everything paid comes back, whatever the tiers say.
    const percent = doctorFault ? 100 : estimateRefund(c, parts, now).percent;
    const split = splitRefund(parts, percent);
    const refundReason: RefundReason = doctorFault ? 'DOCTOR_NO_SHOW' : actor.kind === 'admin' ? 'ADMIN' : 'PATIENT_CANCEL';

    const records = await db.$transaction(async (tx) => {
        const res = await tx.consultation.updateMany({
            // A doctor who joins in the same instant is no longer late; the full refund is then not owed.
            where: { id: c.id, status: { in: [...CANCELLABLE] }, ...(doctorFault ? { doctorJoinedAt: null } : {}) },
            data: { status: 'CANCELLED', cancelledBy, cancelReason: reason, cancelledAt: now },
        });
        if (res.count !== 1) return null;
        await releaseSlot(tx, c.slotId);
        await reopenInstantSlots(tx, c.id, now);
        // A full refund gives the promo use back; a partial one keeps it used (Aditya, 2026-11-23).
        if (percent === 100) await releasePromo(tx, c.id);
        const created = [];
        for (const { part, refundPaise } of split) {
            if (refundPaise <= 0) continue;
            const r = await createRefundRecord(tx, { consultationId: c.id, paymentId: part.id, reason: refundReason, requestedPaise: refundPaise });
            if (r) created.push(r);
        }
        return created;
    });

    if (doctorFault && !records) {
        const after = await db.consultation.findUniqueOrThrow({ where: { id: c.id }, select: { status: true } });
        if (after.status !== 'CANCELLED' && after.status !== 'REFUNDED') {
            throw new DoctorError(409, 'Your doctor has just joined. Please refresh to join the call.');
        }
    }
    if (doctorFault && records) logAlert('consult_doctor_late', { consultationId: c.id, doctorId: c.doctorId, outcome: 'refunded' });
    await runRefunds(records ?? [], { db, razorpay: deps.razorpay });
    return view(db, c.id);
}
