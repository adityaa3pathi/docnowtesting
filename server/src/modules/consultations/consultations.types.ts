export const ConsultationStatus = {
    PENDING_PAYMENT: 'PENDING_PAYMENT',
    CONFIRMED: 'CONFIRMED',
    RESCHEDULED: 'RESCHEDULED',
    WAITING: 'WAITING',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    NO_SHOW_PATIENT: 'NO_SHOW_PATIENT',
    NO_SHOW_DOCTOR: 'NO_SHOW_DOCTOR',
    EXPIRED: 'EXPIRED',
    REFUNDED: 'REFUNDED',
} as const;

export type ConsultationStatus = (typeof ConsultationStatus)[keyof typeof ConsultationStatus];

export const ConsultationType = {
    VIDEO: 'VIDEO',
    AUDIO: 'AUDIO',
    CHAT: 'CHAT',
} as const;

export type ConsultationType = (typeof ConsultationType)[keyof typeof ConsultationType];

/** Consultations whose payment may still arrive or be unresolved. */
export const OPEN_PAYMENT_STATUSES: ConsultationStatus[] = ['PENDING_PAYMENT', 'EXPIRED'];

/** Statuses that hold a slot. Must match the partial unique index in the consult payments migration. */
export const ACTIVE_CONSULTATION_STATUSES: ConsultationStatus[] = [
    'PENDING_PAYMENT',
    'CONFIRMED',
    'RESCHEDULED',
    'WAITING',
    'IN_PROGRESS',
    'COMPLETED',
    'NO_SHOW_PATIENT',
    'NO_SHOW_DOCTOR',
];
