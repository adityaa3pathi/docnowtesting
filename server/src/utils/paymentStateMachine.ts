/**
 * Payment State Machine
 * 
 * Enforces valid state transitions for booking payment status.
 * Call assertTransition() before every paymentStatus update to prevent 
 * state corruption from race conditions, retries, or bugs.
 */
import { PaymentStatus } from '@prisma/client';

const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
    INITIATED: [PaymentStatus.AUTHORIZED, PaymentStatus.FAILED, PaymentStatus.EXPIRED, PaymentStatus.PAID],
    AUTHORIZED: [PaymentStatus.CONFIRMED, PaymentStatus.PARTNER_FAILED],
    PAID: [PaymentStatus.CONFIRMED, PaymentStatus.PARTNER_FAILED],
    PARTNER_FAILED: [PaymentStatus.CONFIRMED, PaymentStatus.REFUNDED],
    CONFIRMED: [],     // terminal
    FAILED: [],     // terminal
    CANCELLED: [],     // terminal
    EXPIRED: [],     // terminal
    REFUNDED: [],     // terminal
};

/**
 * Throws if the transition is not allowed by the state machine.
 * Use before every `booking.update({ paymentStatus })`.
 */
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (!VALID_TRANSITIONS[from]?.includes(to)) {
        throw new Error(`Invalid payment state transition: ${from} → ${to}`);
    }
}

/**
 * Returns true if the transition is allowed (non-throwing variant).
 */
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Conditional status update pattern — prevents stale writes.
 * Only updates if the booking is still in the expected current state.
 * Returns the count of rows updated (0 = state has changed since read).
 */
export function buildConditionalUpdate(bookingId: string, from: PaymentStatus, to: PaymentStatus) {
    assertTransition(from, to);
    return {
        where: { id: bookingId, paymentStatus: from } as any,
        data: { paymentStatus: to } as any
    };
}
