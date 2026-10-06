/**
 * Consultation State Machine
 *
 * Call assertTransition() before every consultation status update.
 * Mirrors utils/paymentStateMachine.ts so both behave the same way.
 */
import { ConsultationStatus as S } from './consultations.types';

const VALID_TRANSITIONS: Record<S, S[]> = {
    PENDING_PAYMENT: [S.CONFIRMED, S.CANCELLED, S.EXPIRED],
    EXPIRED: [S.CONFIRMED], // late payment re-claims a still-free slot
    CONFIRMED: [S.WAITING, S.RESCHEDULED, S.CANCELLED, S.NO_SHOW_PATIENT, S.NO_SHOW_DOCTOR],
    RESCHEDULED: [S.CONFIRMED, S.CANCELLED],
    WAITING: [S.IN_PROGRESS, S.CANCELLED, S.NO_SHOW_PATIENT, S.NO_SHOW_DOCTOR],
    IN_PROGRESS: [S.COMPLETED],
    CANCELLED: [S.REFUNDED],
    NO_SHOW_PATIENT: [S.REFUNDED],
    NO_SHOW_DOCTOR: [S.REFUNDED],
    COMPLETED: [],  // terminal
    REFUNDED: [],   // terminal
};

export function canTransition(from: S, to: S): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: S, to: S): void {
    if (!canTransition(from, to)) {
        throw new Error(`Invalid consultation state transition: ${from} → ${to}`);
    }
}
