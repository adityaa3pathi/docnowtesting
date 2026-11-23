/**
 * The consultation price as the patient sees it before booking: the fee, what the DocNow wallet
 * covers, and what is left to pay by card/UPI. The server works it out again and its numbers win.
 */
export interface ConsultPrice {
    feePaise: number;
    walletPaise: number;
    /** Left for Razorpay. 0: the wallet pays it all and the booking confirms at once. */
    payPaise: number;
}

/** Wallet balances are rupees (a float); the server rounds them to whole paise the same way. */
export function walletRupeesToPaise(balance: number | null | undefined): number {
    if (typeof balance !== 'number' || !Number.isFinite(balance) || balance <= 0) return 0;
    // The server rounds to 2 decimals first (ROUND(balance, 2) * 100); this matches it for real balances.
    return Math.round(balance * 100);
}

/** Razorpay's smallest payment (₹1). The card is never left a smaller share (same rule as the server). */
const MIN_CARD_PAISE = 100;

export function consultPrice(feePaise: number, walletBalancePaise: number, useWallet: boolean): ConsultPrice {
    let walletPaise = useWallet ? Math.max(0, Math.min(walletBalancePaise, feePaise)) : 0;
    const card = feePaise - walletPaise;
    if (card > 0 && card < MIN_CARD_PAISE) walletPaise = Math.max(0, feePaise - MIN_CARD_PAISE);
    return { feePaise, walletPaise, payPaise: feePaise - walletPaise };
}

/** What the booking cost in all (card/UPI plus wallet). Older servers send only amountPaise. */
export function bookingTotalPaise(b: { amountPaise: number; feePaise?: number }): number {
    return b.feePaise ?? b.amountPaise;
}

/** The price lines for a booking already made, for BookingSummary. */
export function bookedPriceLines(
    b: { amountPaise: number; feePaise?: number; walletPaise?: number; status: string; paymentCaptured: boolean },
    format: (paise: number) => string,
) {
    const wallet = b.walletPaise ?? 0;
    if (wallet === 0) return { lines: undefined, amountLabel: 'Amount', amount: format(b.amountPaise) };
    const lines = [
        { label: 'Consultation fee', value: format(bookingTotalPaise(b)) },
        { label: 'From DocNow wallet', value: `− ${format(wallet)}` },
    ];
    if (b.status === 'PENDING_PAYMENT') return { lines, amountLabel: 'To pay now', amount: format(b.amountPaise) };
    // A hold that ended unpaid: nothing was charged and the wallet part went back, so just the fee.
    if (!b.paymentCaptured) return { lines: undefined, amountLabel: 'Amount', amount: format(bookingTotalPaise(b)) };
    if (b.amountPaise === 0) return { lines: undefined, amountLabel: 'Paid from DocNow wallet', amount: format(wallet) };
    return { lines, amountLabel: 'Paid by card/UPI', amount: format(b.amountPaise) };
}

/** Where a refund goes: "₹100 back to your DocNow wallet and ₹150 to your card/UPI". */
export function refundDestination(refundPaise: number, walletRefundPaise: number | undefined, format: (paise: number) => string): string {
    const wallet = Math.min(walletRefundPaise ?? 0, refundPaise);
    const card = refundPaise - wallet;
    if (wallet > 0 && card > 0) return `${format(wallet)} back to your DocNow wallet and ${format(card)} to your card/UPI`;
    if (wallet > 0) return `${format(wallet)} back to your DocNow wallet`;
    return `${format(card)} to your card/UPI`;
}
