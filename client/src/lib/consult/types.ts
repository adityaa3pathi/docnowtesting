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
    /** Given at onboarding; older profiles may not have it yet. */
    gender?: DoctorGender | null;
    /** Earliest bookable time (list endpoint only); null when nothing is open. */
    nextSlotAt?: string | null;
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
    /** Paise, what Razorpay collects: the fee less the wallet part. 0 when the wallet paid it all. */
    amountPaise: number;
    /** Paise. Older servers leave these out (then the fee is amountPaise and nothing came from the wallet). */
    feePaise?: number;
    walletPaise?: number;
    /** Paise taken off by a promo code, and the code (older servers leave these out). */
    discountPaise?: number;
    promoCode?: string | null;
    currency: string;
    keyId: string | null;
    holdExpiresAt: string;
}

export interface BookingView extends CreateBookingResponse {
    /** Consent ticked at sign-up covers this join (own consultation, current wording). */
    consentOnFile?: boolean;
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
    /** The part of refundPaise that goes back to the DocNow wallet; the rest goes to the card/UPI. */
    walletRefundPaise?: number;
    refundStatus: 'PENDING' | 'PROCESSED' | 'FAILED' | null;
    type: ConsultationType;
    hasPrescription: boolean;
    /** The booker's own bookings: whether the time can be changed now (older servers leave it out). */
    selfReschedule?: SelfReschedule;
}

/** Self-serve reschedule: same doctor, until the cutoff before the start, a limited number of times. */
export interface SelfReschedule {
    allowed: boolean;
    /** Why not, in words for the patient; null when allowed. */
    reason: string | null;
    used: number;
    max: number;
    cutoffMinutes: number;
    /** How soon a new time may start, from the booking's rules (older servers leave it out). */
    minLeadMinutes?: number;
    /** Last moment a change is accepted. */
    deadline: string;
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
    /** The parts of paidPaise / refundPaise that came from and go back to the DocNow wallet. */
    walletPaidPaise?: number;
    walletRefundPaise?: number;
    /** The cancellation policy saved with this booking (older servers leave it out). */
    policy?: { refundTiers: { minHoursBefore: number; percent: number }[]; doctorNoShowFullRefund: boolean };
    /** Set when the patient moved the booking: the tiers count to this earlier time. */
    refundBasisStartsAt?: string | null;
}

export interface CancelResult {
    status: ConsultationStatus;
    refundPaise: number;
    walletRefundPaise?: number;
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
    gender?: DoctorGender;
}

export type DoctorGender = 'Male' | 'Female' | 'Other';

export interface DoctorMe extends DoctorSummary {
    userId: string;
    registrationNumber: string;
    registrationCouncil: string;
    status: DoctorStatus;
    statusReason: string | null;
    specialtyId: string;
    availability: AvailabilityWindow[];
    /** Recent changes sent for approval, newest first. Only GET /doctor/me sends it. */
    changeRequests?: DoctorChangeRequest[];
}

export type DoctorChangeKind = 'AVAILABILITY' | 'PROFILE';
export type DoctorChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface HoursChange {
    windows: AvailabilityWindow[];
    slotMinutes: number;
}
export interface ProfileChange {
    bio?: string | null;
    languages?: string[];
    experienceYears?: number;
}

/** A doctor's new hours or profile text waiting for (or decided by) a super admin. */
export interface DoctorChangeRequest {
    id: string;
    kind: DoctorChangeKind;
    /** WITHDRAWN only in the doctor's own list: a change they took back. */
    status: DoctorChangeStatus | 'WITHDRAWN';
    payload: HoursChange | ProfileChange;
    /** The live values when the doctor sent it. */
    previous: HoursChange | ProfileChange;
    reviewReason: string | null;
    createdAt: string;
    reviewedAt: string | null;
}

export interface AdminDoctorChange extends DoctorChangeRequest {
    doctorId: string;
    doctor: { id: string; displayName: string; photoUrl: string | null; status: DoctorStatus; specialty: { name: string } | null };
    /** The doctor's values now, to compare with the request. */
    live: HoursChange | ProfileChange;
    /** Pending hours only: booked appointments outside the new hours (they stay booked). */
    bookedOutsideNewHours: number | null;
}

export interface RecentLeave {
    id: string;
    doctorId: string;
    startsAt: string;
    endsAt: string;
    reason: string | null;
    createdAt: string;
    doctor: { id: string; displayName: string };
    bookedInside: number;
}

export interface DoctorChangeQueue {
    requests: AdminDoctorChange[];
    recentLeave: RecentLeave[];
}

export interface LeaveEntry {
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string | null;
}

export interface AdminDoctor extends Omit<DoctorMe, 'changeRequests'> {
    user?: { mobile: string; email?: string | null };
    /** Changes waiting for approval. Only the detail route sends it. */
    pendingChanges?: { id: string; kind: DoctorChangeKind; createdAt: string }[];
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
    /** A patient can change the time until this long before the start. */
    rescheduleCutoffMinutes: number;
    /** Changes allowed per booking; 0 turns self-serve reschedule off. */
    maxReschedules: number;
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
    /** Paid from the wallet / taken off by a promo; Razorpay was due feePaise minus both (older servers leave them out). */
    walletPaise?: number;
    discountPaise?: number;
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

export type DoseTime = 'MORNING' | 'AFTERNOON' | 'NIGHT';
export type FoodTiming = 'BEFORE_FOOD' | 'AFTER_FOOD' | 'WITH_FOOD' | 'EMPTY_STOMACH';

/**
 * One prescribed medicine. Prescriptions issued before the structured fields (strength, doseTimes,
 * foodTiming, durationDays) have only the free-text ones, so those are optional when reading.
 */
export interface Medicine {
    name: string;
    strength?: string;
    /** How much each time, e.g. "1 tablet". */
    dose: string;
    /** Free text for what the times can't say: "Only when needed". */
    frequency: string;
    doseTimes?: DoseTime[];
    foodTiming?: FoodTiming | null;
    durationDays?: number | null;
    /** Old free-text duration. */
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
        /** With an empty list: set means "no known allergies", null means nobody asked. */
        allergiesConfirmedAt?: string | null;
        chronicConditions?: string[];
        currentMedications?: string[];
    };
    patientJoinedAt: string | null;
    doctorJoinedAt: string | null;
    /** Family bookings: who booked and whether they co-join to assist. */
    caregiver?: { name: string; relation: string; coJoining: boolean; joinedAt: string | null } | null;
    /** DocNow lab reports shared for this consultation; `viewToken` opens /api/reports/public/:token. */
    attachedReports?: { id: string; label: string; isFullReport: boolean; date: string; viewToken: string }[];
    /** Photos / PDFs of outside records the booker uploaded; `url` is signed and expires within the hour. */
    attachments?: ConsultAttachment[];
    note: ConsultNote | null;
    /** The current version only; voided ones are in previousVersions. */
    prescription: Prescription | null;
    previousVersions: PrescriptionVersion[];
}

export interface ConsultAttachment {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
    url: string;
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
    /** Older servers leave these out. */
    walletPaise?: number;
    discountPaise?: number;
    promoCode?: { code: string } | null;
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
    payments: { id: string; source?: 'RAZORPAY' | 'WALLET'; status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'RELEASED'; amountPaise: number; razorpayPaymentId: string | null; createdAt: string }[];
    refunds: { id: string; status: 'PENDING' | 'PROCESSED' | 'FAILED'; amountPaise: number; createdAt: string }[];
    cancelledBy: string | null;
    cancelReason: string | null;
    cancelledAt: string | null;
    createdAt: string;
}

// ── Manager: no-shows and late joins ───────────────────

export type AttendanceOutcome = 'ON_TIME' | 'LATE' | 'NO_SHOW' | 'NOT_JOINED';

export interface AttendanceSide {
    outcome: AttendanceOutcome;
    joinedAt: string | null;
    minutesLate: number | null;
}

export interface AttendanceCounts {
    consultations: number;
    noShows: number;
    late: number;
    avgMinutesLate: number | null;
}

export interface AttendanceReport {
    from: string;
    to: string;
    lateAfterMinutes: number;
    /** More consultations than one report loads: counts are partial, pick a shorter range. */
    truncated: boolean;
    totals: { consultations: number; doctor: AttendanceCounts; patient: AttendanceCounts };
    doctors: (AttendanceCounts & { doctorId: string; name: string })[];
    patients: (AttendanceCounts & { patientId: string; name: string; mobile: string | null })[];
    /** All problem consultations in the range; `issues` holds only the newest ones (the CSV has all). */
    issuesTotal: number;
    issues: {
        consultationId: string;
        startsAt: string;
        /** MOVED: the appointment a late doctor lost (see `moved`). */
        status: ConsultationStatus | 'MOVED';
        doctorId: string;
        doctorName: string;
        patientId: string;
        patientName: string;
        mobile: string | null;
        doctor: AttendanceSide;
        patient: AttendanceSide;
        /** The patient moved away because this doctor was late; startsAt is the original time. */
        moved?: { moveId: string; kind: 'DOCTOR_LATE_RESCHEDULE' | 'DOCTOR_LATE_REASSIGN'; toDoctorName: string; toStartsAt: string } | null;
    }[];
}

/** A promo code's effect on one doctor's fee (POST /consult/promos/check, GET /consult/promos). */
export interface ConsultPromoQuote {
    code: string;
    description: string | null;
    discountPaise: number;
}
