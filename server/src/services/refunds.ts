/**
 * Refunds for lab bookings that could not be fulfilled. One place decides what "refunded" means:
 * the card part goes back through Razorpay, then the wallet and promo come back too.
 */
import { getRazorpay } from './razorpay';
import { rollbackInitiatedBooking } from './rollback';
import { logAlert, logBusinessEvent } from '../utils/logger';

/** Fully wallet- or promo-paid bookings carry a ZERO_ placeholder, not a Razorpay payment. */
export function isRealOnlinePayment(paymentId?: string | null): paymentId is string {
    return Boolean(paymentId && !paymentId.startsWith('ZERO_'));
}

interface RefundableBooking {
    id: string;
    userId: string;
    razorpayPaymentId: string | null;
    walletAmount: number;
    promoCodeId: string | null;
}

/** Sends the card refund, if any. "refunded" means nothing is left owing on the card. */
export async function refundCardPayment(booking: RefundableBooking, reason: string): Promise<'refunded' | 'manual_required'> {
    if (!isRealOnlinePayment(booking.razorpayPaymentId)) return 'refunded';
    try {
        logBusinessEvent('refund_started', { bookingId: booking.id, razorpayPaymentId: booking.razorpayPaymentId, reason });
        await getRazorpay().payments.refund(booking.razorpayPaymentId, { notes: { reason, bookingId: booking.id } });
        return 'refunded';
    } catch (error) {
        logAlert('refund_failed_manual_required', { error, bookingId: booking.id, razorpayPaymentId: booking.razorpayPaymentId });
        return 'manual_required';
    }
}

/** Returns wallet money and promo usage. Idempotent: the ledger and redemption rows guard replays. */
export async function restoreWalletAndPromo(booking: RefundableBooking) {
    await rollbackInitiatedBooking(booking);
}
