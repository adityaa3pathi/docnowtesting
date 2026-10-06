/**
 * The only place that changes a consultation's status together with its slot, so a slot is booked
 * exactly when one active consultation points at it. Every change is a conditional update.
 */
import { Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

/** Moves a slot from available to booked. False means someone else holds it. */
export async function holdSlot(tx: Tx, slotId: string): Promise<boolean> {
    const res = await tx.slot.updateMany({ where: { id: slotId, status: 'AVAILABLE' }, data: { status: 'BOOKED' } });
    return res.count === 1;
}

/** Expires an unpaid hold and frees its slot. False when the consultation is no longer pending payment. */
export async function expireHold(tx: Tx, consultationId: string): Promise<boolean> {
    const c = await tx.consultation.findUnique({ where: { id: consultationId }, select: { slotId: true } });
    if (!c) return false;
    const res = await tx.consultation.updateMany({
        where: { id: consultationId, status: 'PENDING_PAYMENT' },
        data: { status: 'EXPIRED' },
    });
    if (res.count !== 1) return false;
    await tx.slot.updateMany({ where: { id: c.slotId, status: 'BOOKED' }, data: { status: 'AVAILABLE' } });
    return true;
}
