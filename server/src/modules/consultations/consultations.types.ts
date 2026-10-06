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
