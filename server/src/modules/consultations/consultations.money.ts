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

/** Refund for a whole-number percentage of what was paid, capped by what is still refundable. */
export function refundForPercent(paidPaise: number, percent: number, alreadyRefundedPaise: number): number {
    const raw = Math.floor((paidPaise * percent + 50) / 100);
    return Math.min(raw, remainingRefundable(paidPaise, alreadyRefundedPaise));
}
