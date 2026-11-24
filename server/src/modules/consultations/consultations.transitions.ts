/**
 * The only place that changes a consultation's status together with its slot, so a slot is booked
 * exactly when one active consultation points at it. Every change is a conditional update.
 */
import { Prisma } from '@prisma/client';
import { captureWalletHold, releaseWalletHold, retakeWalletHold } from './consultations.wallet';
import { releasePromo, retakePromo } from './consultations.promo';

export type Tx = Prisma.TransactionClient;

/** Frees a booked slot. A no-op when it is not booked. */
export function releaseSlot(tx: Tx, slotId: string) {
    return tx.slot.updateMany({ where: { id: slotId, status: 'BOOKED' }, data: { status: 'AVAILABLE' } });
}

/** Moves a slot from available to booked. False means someone else holds it. */
export async function holdSlot(tx: Tx, slotId: string): Promise<boolean> {
    const res = await tx.slot.updateMany({ where: { id: slotId, status: 'AVAILABLE' }, data: { status: 'BOOKED' } });
    return res.count === 1;
}

/** Expires an unpaid hold, frees its slot and gives back any wallet part and promo use. False when the consultation is no longer pending payment. */
export async function expireHold(tx: Tx, consultationId: string): Promise<boolean> {
    const c = await tx.consultation.findUnique({ where: { id: consultationId }, select: { slotId: true } });
    if (!c) return false;
    const res = await tx.consultation.updateMany({
        where: { id: consultationId, status: 'PENDING_PAYMENT' },
        data: { status: 'EXPIRED' },
    });
    if (res.count !== 1) return false;
    await releaseSlot(tx, c.slotId);
    await releaseWalletHold(tx, consultationId);
    await releasePromo(tx, consultationId);
    return true;
}

export class SlotLost extends Error {}

/**
 * Pending payment to confirmed, once, recording which payment did it (a Razorpay payment id, or
 * walletConfirmation() for a booking the wallet paid in full). False when another caller won.
 */
export async function confirmPending(tx: Tx, consultationId: string, paymentId: string, now = new Date()): Promise<boolean> {
    const res = await tx.consultation.updateMany({
        where: { id: consultationId, status: 'PENDING_PAYMENT', confirmingPaymentId: null },
        data: { status: 'CONFIRMED', confirmingPaymentId: paymentId, reviewReason: null },
    });
    if (res.count !== 1) return false;
    await captureWalletHold(tx, consultationId, now);
    await startInstantOnPayment(tx, consultationId, now);
    return true;
}

/**
 * An instant consult starts when it is paid, not when the doctor accepted: the doctor's 5-minute
 * join window and the no-show refund count from here. Only the consultation's start and the slot's
 * end move (the slot's start is unique per doctor, and a clash must never fail a payment). The
 * doctor's free slots under the call go off sale, remembered on the request so a cancel reopens them.
 */
async function startInstantOnPayment(tx: Tx, consultationId: string, now: Date) {
    const c = await tx.consultation.findUnique({
        where: { id: consultationId },
        select: { isInstant: true, doctorId: true, slotId: true, slot: { select: { startsAt: true, endsAt: true } } },
    });
    if (!c?.isInstant) return;
    const endsAt = new Date(now.getTime() + (c.slot.endsAt.getTime() - c.slot.startsAt.getTime()));
    await tx.consultation.update({ where: { id: consultationId }, data: { startsAt: now } });
    await tx.slot.update({ where: { id: c.slotId }, data: { endsAt } });
    const under = await tx.slot.findMany({ where: { doctorId: c.doctorId, status: 'AVAILABLE', startsAt: { lt: endsAt }, endsAt: { gt: now } }, select: { id: true } });
    const ids = under.map((s) => s.id);
    if (ids.length) await tx.slot.updateMany({ where: { id: { in: ids }, status: 'AVAILABLE' }, data: { status: 'BLOCKED' } });
    // The request is done once its booking is paid.
    await tx.instantRequest.updateMany({ where: { consultationId, status: 'ACCEPTED' }, data: { status: 'BOOKED', endedAt: now, blockedSlotIds: ids } });
}

/** A paid instant consult that ends without the call (cancelled, doctor no-show): its blocked slots go back on sale. */
export async function reopenInstantSlots(tx: Tx, consultationId: string, now = new Date()) {
    const r = await tx.instantRequest.findUnique({ where: { consultationId }, select: { blockedSlotIds: true } });
    if (!r?.blockedSlotIds.length) return;
    await tx.slot.updateMany({ where: { id: { in: r.blockedSlotIds }, status: 'BLOCKED', startsAt: { gt: now } }, data: { status: 'AVAILABLE' } });
}

/** confirmingPaymentId of a booking the wallet paid in full. Never a Razorpay id (those start "pay_"). */
export const walletConfirmation = (walletPartId: string) => `wallet:${walletPartId}`;
/** confirmingPaymentId of a booking a promo made free (nothing paid at all). */
export const freeConfirmation = (consultationId: string) => `free:${consultationId}`;
/** Confirmed in the booking call itself, with no Razorpay payment. */
export const confirmedWithoutRazorpay = (confirmingPaymentId: string | null) => !!confirmingPaymentId && /^(wallet|free):/.test(confirmingPaymentId);

/**
 * Late payment on an expired hold: take the slot back (and the wallet part, given back at expiry)
 * and confirm, or throw SlotLost so the whole transaction rolls back and the caller refunds instead.
 * Instant consults are never re-claimed.
 */
export async function reclaimExpired(tx: Tx, consultationId: string, slotId: string, paymentId: string, now = new Date()): Promise<void> {
    // An instant consult paid after its time: the doctor was already freed for other patients, so it
    // is never confirmed late; the caller refunds it. (confirmPayment already refunds an expired booking
    // whose start has passed, which an instant one always has; this guard keeps that true if it changes.)
    const kind = await tx.consultation.findUnique({ where: { id: consultationId }, select: { isInstant: true } });
    if (kind?.isInstant) throw new SlotLost('instant');
    if (!(await holdSlot(tx, slotId))) throw new SlotLost();
    if (!(await retakeWalletHold(tx, consultationId, now))) throw new SlotLost('wallet');
    await retakePromo(tx, consultationId);
    try {
        const res = await tx.consultation.updateMany({
            where: { id: consultationId, status: 'EXPIRED', confirmingPaymentId: null },
            data: { status: 'CONFIRMED', confirmingPaymentId: paymentId, reviewReason: null },
        });
        if (res.count !== 1) throw new SlotLost();
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new SlotLost();
        throw e;
    }
}
