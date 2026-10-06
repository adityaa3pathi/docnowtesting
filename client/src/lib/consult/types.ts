export type ConsultationStatus =
    | 'PENDING_PAYMENT' | 'CONFIRMED' | 'RESCHEDULED' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED'
    | 'CANCELLED' | 'NO_SHOW_PATIENT' | 'NO_SHOW_DOCTOR' | 'EXPIRED' | 'REFUNDED';

export type DoctorStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface Specialty {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    isActive: boolean;
}

export interface DoctorSummary {
    id: string;
    displayName: string;
    photoUrl: string | null;
    qualification: string;
    experienceYears: number;
    languages: string[];
    bio: string | null;
    /** Rupees, not paise. */
    consultationFee: number;
    slotMinutes: number;
    specialty: { id: string; name: string; slug: string };
}

export interface DoctorPublicProfile extends DoctorSummary {
    registrationNumber: string;
    registrationCouncil: string;
}

export interface Slot {
    id: string;
    startsAt: string;
    endsAt: string;
}

export interface CreateBookingResponse {
    consultationId: string;
    status: ConsultationStatus;
    razorpayOrderId: string | null;
    /** Paise. */
    amountPaise: number;
    currency: string;
    keyId: string | null;
    holdExpiresAt: string;
}

export interface BookingView extends CreateBookingResponse {
    startsAt: string;
    endsAt: string;
    doctorId: string;
    doctorName: string;
    specialty: string;
    patientId: string;
    patientName: string;
    paymentCaptured: boolean;
    underStaffCheck: boolean;
    refundPaise: number;
    refundStatus: 'PENDING' | 'PROCESSED' | 'FAILED' | null;
}

export type VerifyOutcome = 'confirmed' | 'reclaimed' | 'already' | 'refund_created' | 'flagged' | 'unknown_order';

export interface VerifyResponse {
    outcome: VerifyOutcome;
    status: ConsultationStatus;
}

export interface CancelPreview {
    percent: number;
    refundPaise: number;
    paidPaise: number;
}

export interface CancelResult {
    status: ConsultationStatus;
    refundPaise: number;
    refundStatus: 'PENDING' | 'PROCESSED' | 'FAILED' | null;
}

export interface AvailabilityWindow {
    id?: string;
    /** 0 = Sunday, in Indian time. */
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
}

export interface DoctorProfileInput {
    displayName: string;
    specialtyId: string;
    qualification: string;
    registrationNumber: string;
    registrationCouncil: string;
    experienceYears: number;
    languages: string[];
    bio?: string;
    photoUrl?: string;
}

export interface DoctorMe extends DoctorSummary {
    userId: string;
    registrationNumber: string;
    registrationCouncil: string;
    status: DoctorStatus;
    statusReason: string | null;
    specialtyId: string;
    availability: AvailabilityWindow[];
}

export interface LeaveEntry {
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string | null;
}

export interface AdminDoctor extends DoctorMe {
    user?: { mobile: string; email?: string | null };
}

export interface RefundTier {
    minHoursBefore: number;
    percent: number;
}

export interface ConsultRules {
    refundTiers: RefundTier[];
    doctorNoShowWaitMinutes: number;
    patientNoShowWaitMinutes: number;
    doctorNoShowOutcome: 'FULL_REFUND';
    platformFeeBps: number;
    holdMinutes: number;
    minLeadMinutes: number;
    uploadLimitMb: number;
}

export interface PolicyVersion {
    id: string;
    version: number;
    isActive: boolean;
    rules: ConsultRules;
    reason: string | null;
    createdAt: string;
}

export interface PolicyResponse {
    active: { id: string; version: number; rules: ConsultRules; reason: string | null; createdAt: string };
    versions: PolicyVersion[];
}

export interface FlaggedPayment {
    id: string;
    status: ConsultationStatus;
    reviewReason: string | null;
    feePaise: number;
    updatedAt: string;
}

export interface RefundNeedingStaff {
    id: string;
    consultationId: string;
    reason: string;
    amountPaise: number;
    status: string;
    attempts: number;
    lastError: string | null;
    failureConfirmed: boolean;
}

export interface ReviewQueue {
    flaggedPayments: FlaggedPayment[];
    refundsNeedingStaff: RefundNeedingStaff[];
}
