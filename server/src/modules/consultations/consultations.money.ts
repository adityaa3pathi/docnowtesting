/**
 * Consultation money helpers. All amounts are whole paise; rupees convert once at the booking edge.
 * Every rounding is half up and happens once on the total, never per component.
 */
export function toPaise(rupees: number): number {
    if (!Number.isFinite(rupees) || rupees < 0) throw new Error('Amount must be a non-negative number');
    return Math.round(rupees * 100);
}

/** Fee as basis points (1200 = 12%) of an amount in paise. */
export function feeFromBps(amountPaise: number, bps: number): number {
    return Math.floor((amountPaise * bps + 5000) / 10000);
}

export function remainingRefundable(paidPaise: number, refundedPaise: number): number {
    return Math.max(0, paidPaise - refundedPaise);
}

/** Refund for a whole-number percentage of what was paid. Never more than was paid. */
export function refundForPercent(paidPaise: number, percent: number): number {
    return Math.min(paidPaise, Math.floor((paidPaise * percent + 50) / 100));
}

/** Razorpay's smallest order and refund: ₹1. */
export const MIN_CARD_PAISE = 100;

/**
 * How much of the fee to take from a wallet holding `balancePaise`. Never leaves the card a share
 * Razorpay cannot take (under ₹1): then the wallet takes a little less, or the whole fee if it can.
 */
export function walletShare(feePaise: number, balancePaise: number): number {
    const take = Math.max(0, Math.min(balancePaise, feePaise));
    const card = feePaise - take;
    if (card > 0 && card < MIN_CARD_PAISE) return Math.max(0, feePaise - MIN_CARD_PAISE);
    return take;
}

/** What Razorpay collects: the fee less what the wallet covers. */
export function cardDuePaise(c: { feePaise: number; walletPaise: number }): number {
    return Math.max(0, c.feePaise - c.walletPaise);
}

type PartRow = { source: 'RAZORPAY' | 'WALLET'; status: string; razorpayPaymentId: string | null };

/**
 * The payments that paid for a confirmed booking: the card payment that confirmed it, and the
 * wallet part once captured. Duplicate or late card payments are not among them (they are refunded).
 */
export function paidParts<P extends PartRow>(c: { confirmingPaymentId: string | null; payments: P[] }): P[] {
    return c.payments.filter((p) =>
        p.source === 'WALLET'
            ? p.status === 'CAPTURED'
            : p.razorpayPaymentId !== null && p.razorpayPaymentId === c.confirmingPaymentId);
}
