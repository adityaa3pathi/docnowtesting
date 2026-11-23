/**
 * The consultation price as the patient sees it before booking: the fee, what the DocNow wallet
 * covers, and what is left to pay by card/UPI. The server works it out again and its numbers win.
 */
export interface ConsultPrice {
    feePaise: number;
    /** Taken off by a promo code. */
    discountPaise: number;
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

/** The promo discount comes off first; the wallet then covers what is left (same order as the server). */
export function consultPrice(feePaise: number, walletBalancePaise: number, useWallet: boolean, discountPaise = 0): ConsultPrice {
    const discount = Math.max(0, Math.min(discountPaise, feePaise));
    const afterDiscount = feePaise - discount;
    let walletPaise = useWallet ? Math.max(0, Math.min(walletBalancePaise, afterDiscount)) : 0;
    const card = afterDiscount - walletPaise;
    if (card > 0 && card < MIN_CARD_PAISE) walletPaise = Math.max(0, afterDiscount - MIN_CARD_PAISE);
    return { feePaise, discountPaise: discount, walletPaise, payPaise: afterDiscount - walletPaise };
}

/** The lines above the total on the review-and-pay page. None when nothing comes off the fee. */
export function priceLines(p: ConsultPrice, format: (paise: number) => string, promoCode?: string | null) {
    if (p.discountPaise === 0 && p.walletPaise === 0) return undefined;
    return [
        { label: 'Consultation fee', value: format(p.feePaise) },
        ...(p.discountPaise > 0 ? [{ label: promoCode ? `Promo ${promoCode}` : 'Promo discount', value: `− ${format(p.discountPaise)}` }] : []),
        ...(p.walletPaise > 0 ? [{ label: 'From DocNow wallet', value: `− ${format(p.walletPaise)}` }] : []),
    ];
}

/**
 * What the booking costs in all (card/UPI plus wallet), after any promo. A hold that ended unpaid
 * gave its promo use back, so it shows the full fee. Older servers send only amountPaise.
 */
export function bookingTotalPaise(b: { amountPaise: number; feePaise?: number; discountPaise?: number; status?: string; paymentCaptured?: boolean }): number {
    if (b.feePaise === undefined) return b.amountPaise;
    const endedUnpaid = b.paymentCaptured === false && b.amountPaise > 0 && b.status !== undefined && b.status !== 'PENDING_PAYMENT';
    return endedUnpaid ? b.feePaise : b.feePaise - (b.discountPaise ?? 0);
}

/** The price lines for a booking already made, for BookingSummary. */
export function bookedPriceLines(
    b: { amountPaise: number; feePaise?: number; walletPaise?: number; discountPaise?: number; promoCode?: string | null; status: string; paymentCaptured: boolean },
    format: (paise: number) => string,
) {
    const wallet = b.walletPaise ?? 0;
    const discount = b.discountPaise ?? 0;
    if (wallet === 0 && discount === 0) return { lines: undefined, amountLabel: 'Amount', amount: format(b.amountPaise) };
    const lines = priceLines({ feePaise: b.feePaise ?? b.amountPaise, discountPaise: discount, walletPaise: wallet, payPaise: b.amountPaise }, format, b.promoCode);
    if (b.status === 'PENDING_PAYMENT') return { lines, amountLabel: 'To pay now', amount: format(b.amountPaise) };
    // A hold that ended unpaid: nothing was charged and the wallet part went back, so just the price.
    if (!b.paymentCaptured && b.amountPaise > 0) return { lines: undefined, amountLabel: 'Amount', amount: format(bookingTotalPaise(b)) };
    if (b.amountPaise === 0) {
        if (wallet > 0) return { lines: discount > 0 ? lines : undefined, amountLabel: 'Paid from DocNow wallet', amount: format(wallet) };
        return { lines, amountLabel: 'You paid', amount: format(0) };
    }
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
