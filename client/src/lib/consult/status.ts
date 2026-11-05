import type { ConsultationStatus, DoctorStatus, VerifyOutcome } from './types';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

export interface StatusInfo {
    label: string;
    tone: Tone;
    canCancel: boolean;
}

const STATUS: Record<ConsultationStatus, StatusInfo> = {
    PENDING_PAYMENT: { label: 'Waiting for payment', tone: 'warning', canCancel: true },
    CONFIRMED: { label: 'Confirmed', tone: 'success', canCancel: true },
    RESCHEDULED: { label: 'Rescheduled', tone: 'info', canCancel: true },
    WAITING: { label: 'Starting soon', tone: 'info', canCancel: true },
    IN_PROGRESS: { label: 'In progress', tone: 'info', canCancel: false },
    COMPLETED: { label: 'Completed', tone: 'muted', canCancel: false },
    CANCELLED: { label: 'Cancelled', tone: 'muted', canCancel: false },
    NO_SHOW_PATIENT: { label: 'Missed by patient', tone: 'muted', canCancel: false },
    NO_SHOW_DOCTOR: { label: 'Missed by doctor', tone: 'danger', canCancel: false },
    EXPIRED: { label: 'Hold ended', tone: 'muted', canCancel: false },
    REFUNDED: { label: 'Refunded', tone: 'muted', canCancel: false },
};

export const statusInfo = (status: ConsultationStatus): StatusInfo => STATUS[status];

const DOCTOR_STATUS: Record<DoctorStatus, { label: string; tone: Tone }> = {
    PENDING: { label: 'Waiting for approval', tone: 'warning' },
    APPROVED: { label: 'Approved', tone: 'success' },
    REJECTED: { label: 'Not approved', tone: 'danger' },
    SUSPENDED: { label: 'Suspended', tone: 'danger' },
};

export const doctorStatusInfo = (status: DoctorStatus) => DOCTOR_STATUS[status];

/** What to tell the patient after the payment check. Never says "failed" for a payment that may have gone through. */
export const VERIFY_MESSAGES: Record<VerifyOutcome, { title: string; body: string; tone: Tone }> = {
    confirmed: { title: 'Your consultation is booked', body: 'We have your payment. You can see this booking in My consultations.', tone: 'success' },
    reclaimed: { title: 'Your consultation is booked', body: 'Your payment arrived after the hold ended, and the slot was still free, so it is booked.', tone: 'success' },
    already: { title: 'Your consultation is booked', body: 'This payment was already recorded.', tone: 'success' },
    refund_created: { title: 'The slot was taken, your money is coming back', body: 'Your payment came in after the hold ended and someone else had the slot. A full refund is on its way to your original payment method.', tone: 'warning' },
    flagged: { title: 'We are checking your payment', body: 'Something about this payment needs a quick check by our team. You do not need to pay again. Check My consultations for updates.', tone: 'warning' },
    unknown_order: { title: 'We are confirming your payment', body: 'We could not match this payment yet. If you were charged, it will show in My consultations once confirmed.', tone: 'warning' },
};

export const HOLD_ENDED_MESSAGE = 'This hold ended. If you already paid, it will show in My consultations once confirmed.';
export const CONFIRMING_MESSAGE = 'We are confirming your payment, please do not pay again.';

export const toneClasses: Record<Tone, string> = {
    success: 'bg-green-100 text-green-700',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-primary/10 text-primary',
    muted: 'bg-gray-100 text-gray-600',
};
