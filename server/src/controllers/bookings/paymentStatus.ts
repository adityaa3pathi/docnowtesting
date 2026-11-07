import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

export type CheckoutOutcome = 'confirmed' | 'pending' | 'refunded' | 'not_paid';

/**
 * What the customer should be told after checkout. Live tracking (/status) only works once the
 * lab booking exists, so it cannot say "payment received, still confirming" or "refunded".
 */
export function checkoutOutcome(paymentStatus: string): CheckoutOutcome {
    if (paymentStatus === 'CONFIRMED') return 'confirmed';
    if (paymentStatus === 'REFUNDED') return 'refunded';
    if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(paymentStatus)) return 'not_paid';
    // INITIATED (webhook not in yet), AUTHORIZED, PAID, PROCESSING, PARTNER_FAILED (retrying)
    return 'pending';
}

/** GET /api/bookings/:id/payment-status — owner only. */
export const getPaymentStatus = async (req: AuthRequest, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: 'We could not find this booking.' });

    const booking = await prisma.booking.findFirst({
        where: { id: id.data, userId: req.userId },
        select: { paymentStatus: true, slotDate: true, slotTime: true, addressLine: true, addressCity: true, addressPincode: true },
    });
    if (!booking) return res.status(404).json({ error: 'We could not find this booking.' });

    res.json({
        outcome: checkoutOutcome(booking.paymentStatus),
        slotDate: booking.slotDate,
        slotTime: booking.slotTime,
        address: booking.addressLine ? { line1: booking.addressLine, city: booking.addressCity, pincode: booking.addressPincode } : undefined,
    });
};
