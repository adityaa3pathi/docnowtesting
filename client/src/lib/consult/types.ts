export type ConsultationStatus =
    | 'PENDING_PAYMENT' | 'CONFIRMED' | 'RESCHEDULED' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED'
    | 'CANCELLED' | 'NO_SHOW_PATIENT' | 'NO_SHOW_DOCTOR' | 'EXPIRED' | 'REFUNDED';

export type DoctorStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type ConsultationType = 'VIDEO' | 'AUDIO' | 'CHAT';

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
    type: ConsultationType;
    hasPrescription: boolean;
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
    /** Doctor no-shows in the last 30 days. Only the list route sends it. */
    noShows30d?: number;
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

// ── Video room and prescriptions ────────────────────────

export interface JoinResponse {
    /** LiveKit server URL (wss). */
    url: string;
    roomId: string;
    /** `doctor`, `patient`, or an `-audio` variant that may only publish the microphone. */
    role: string;
    /** LiveKit access token for this person and room; it carries their display name. */
    token: string;
}

export interface Medicine {
    name: string;
    dose: string;
    frequency: string;
    duration: string;
    instructions: string;
}

export interface RecommendedTest {
    code: string;
    name: string;
}

export interface Prescription {
    id: string;
    consultationId: string;
    /** Starts at 1; a correction voids the current version and issues the next. */
    version: number;
    medicines: Medicine[];
    recommendedTests: RecommendedTest[];
    advice: string | null;
    doctorSnapshot: { displayName: string; qualification: string; registrationNumber: string; registrationCouncil: string; specialty: string };
    patientSnapshot: { name: string; age: number; gender: string };
    issuedAt: string;
}

export interface PrescriptionInput {
    medicines: Medicine[];
    testCodes: string[];
    advice?: string;
}

export interface ConsultNote {
    complaints: string | null;
    findings: string | null;
    diagnosis: string | null;
    advice: string | null;
    followUpDays: number | null;
    updatedAt: string;
}

export interface NoteInput {
    complaints?: string;
    findings?: string;
    diagnosis?: string;
    advice?: string;
    followUpDays?: number | null;
}

export interface CartAddResult {
    added: string[];
    skipped: { code: string; reason: string }[];
}

export interface DoctorConsultationItem {
    id: string;
    startsAt: string;
    endsAt: string;
    status: ConsultationStatus;
    type: ConsultationType;
    patientName: string;
}

export interface DoctorConsultationPage {
    items: DoctorConsultationItem[];
    nextCursor: string | null;
}

export interface DoctorConsultationRecord {
    id: string;
    status: ConsultationStatus;
    type: ConsultationType;
    startsAt: string;
    slot: { endsAt: string };
    patient: {
        name: string;
        age: number;
        gender: string;
        // Clinical snapshot from the family intake (older servers leave these out).
        relation?: string;
        preferredLanguage?: string;
        bloodGroup?: string | null;
        allergies?: string[];
        chronicConditions?: string[];
        currentMedications?: string[];
    };
    patientJoinedAt: string | null;
    doctorJoinedAt: string | null;
    /** Family bookings: who booked and whether they co-join to assist. */
    caregiver?: { name: string; relation: string; coJoining: boolean; joinedAt: string | null } | null;
    /** DocNow lab reports shared for this consultation; `viewToken` opens /api/reports/public/:token. */
    attachedReports?: { id: string; label: string; isFullReport: boolean; date: string; viewToken: string }[];
    note: ConsultNote | null;
    /** The current version only; voided ones are in previousVersions. */
    prescription: Prescription | null;
    previousVersions: PrescriptionVersion[];
}

export interface PrescriptionVersion {
    id: string;
    version: number;
    issuedAt: string;
    voidedAt: string;
    voidReason: string | null;
}

// ── Admin appointments ──────────────────────────────────

export interface AdminAppointment {
    id: string;
    status: ConsultationStatus;
    type: ConsultationType;
    startsAt: string;
    endsAt: string;
    feePaise: number;
    platformFeePaise: number;
    patientJoinedAt: string | null;
    doctorJoinedAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
    reviewReason: string | null;
    doctor: { id: string; displayName: string; specialty: { name: string } };
    patient: { name: string };
    user: { mobile: string };
    prescriptionIssuedAt: string | null;
    prescriptionVersion: number | null;
}

export interface AdminAppointmentDetail extends AdminAppointment {
    payments: { id: string; status: 'CREATED' | 'CAPTURED' | 'FAILED'; amountPaise: number; razorpayPaymentId: string | null; createdAt: string }[];
    refunds: { id: string; status: 'PENDING' | 'PROCESSED' | 'FAILED'; amountPaise: number; createdAt: string }[];
    cancelledBy: string | null;
    cancelReason: string | null;
    cancelledAt: string | null;
    createdAt: string;
}
