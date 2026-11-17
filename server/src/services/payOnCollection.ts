/**
 * Pay on collection (cash on delivery): the booking is sent to Healthians as "cod" and their
 * collector takes the amount at the home visit. Off unless PAY_ON_COLLECTION_ENABLED=true.
 */
export const PAY_ON_COLLECTION = 'PAY_ON_COLLECTION';
/** Placeholder payment id, like ZERO_ for wallet-paid bookings: never a Razorpay payment. */
export const COD_PAYMENT_PREFIX = 'COD_';

export function payOnCollectionEnabled(): boolean {
    return process.env.PAY_ON_COLLECTION_ENABLED === 'true';
}

/** Healthians takes whole rupees only; the paisa goes to the customer as discount, never charged extra. */
export function collectAmount(rawFinal: number): { collect: number; extraDiscount: number } {
    const collect = Math.max(0, Math.floor(rawFinal + 1e-9));
    return { collect, extraDiscount: Math.max(0, rawFinal - collect) };
}

/** Whether Healthians' paid_amount covers what we asked them to collect (whole rupees). */
export function isFullyCollected(paidAmount: string | number | undefined, due: number): boolean {
    const paid = Number(paidAmount);
    return Number.isFinite(paid) && paid + 0.5 >= Math.floor(due);
}
