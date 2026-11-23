/** One typed call per consultation route, so screens never write raw URLs. */
import type { AxiosResponse } from 'axios';
import api, { downloadAuthenticatedFile } from '@/lib/api';
import { CONSENT_VERSION, RECORD_SHARE_VERSION } from './consent';
import { recordServerDate } from './time';
import type { GuestInfo } from './guest';
import type {
    ConsultPromoQuote,
    AdminAppointment, AdminAppointmentDetail, AdminDoctor, DoctorChangeQueue, DoctorChangeRequest, DoctorChangeStatus, AttendanceReport, AvailabilityWindow, BookingView, CancelPreview, DoctorGender, CancelResult,
    CartAddResult, ConsultNote, ConsultRules, ConsultationStatus, CreateBookingResponse, DoctorConsultationPage,
    DoctorConsultationRecord, DoctorMe, DoctorProfileInput, DoctorPublicProfile, DoctorSummary, JoinResponse, LeaveEntry,
    NoteInput, PolicyResponse, Prescription, PrescriptionInput, ReviewQueue, Slot, Specialty, VerifyResponse,
    PatientDocument, RecordSharing, SharedItemKind, SharedItemLink, SharedRecord,
} from './types';

/** Reads the server's clock from every response, so hold countdowns do not depend on the device clock. */
function data<T>(res: AxiosResponse<T>): T {
    recordServerDate(res.headers?.date as string | undefined);
    return res.data;
}

/** The server's own message when there is one, otherwise a plain fallback. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
    const err = e as { response?: { data?: { error?: string } }; isNetworkError?: boolean; message?: string };
    if (err?.response?.data?.error) return err.response.data.error;
    if (err?.isNetworkError) return 'We could not reach the server. Check your connection and try again.';
    return fallback;
}

export function errorStatus(e: unknown): number | undefined {
    return (e as { response?: { status?: number } })?.response?.status;
}

// ── Family member on the zero-login web room (no sign-in) ──

export const guest = {
    info: (token: string) => api.get<GuestInfo>(`/consult/guest/${encodeURIComponent(token)}`).then(data),
    /** `consent` is the NMC teleconsultation checkbox; the server refuses the join without it. */
    join: (token: string, consent: true) =>
        api.post<JoinResponse & { identity: string }>(`/consult/guest/${encodeURIComponent(token)}/join`, { consent, consentVersion: CONSENT_VERSION }).then(data),
};

// ── Call failures, reported from the call screen ────────

export type CallEventName = 'connect_failed' | 'disconnected' | 'media_failed' | 'reconnected';

/** The LiveKit join token is the credential, so the zero-login family guest can report too. */
export const callEvents = {
    report: (token: string, event: CallEventName, reason?: string): Promise<void> =>
        api.post('/consult/call-events', { token, event, reason: reason?.slice(0, 200) }, {
            // Every status resolves: a 401 here must not trigger the shared refresh-or-redirect,
            // which would throw a guest out of the call. Callers still .catch(() => {}) for offline.
            validateStatus: () => true,
            timeout: 5_000,
        }).then(() => undefined),
};

// ── Patient ─────────────────────────────────────────────

export const consult = {
    specialties: () => api.get<Specialty[]>('/consult/specialties').then(data),
    doctors: (specialtyId?: string) =>
        api.get<DoctorSummary[]>('/consult/doctors', { params: specialtyId ? { specialtyId } : undefined }).then(data),
    doctor: (id: string) => api.get<DoctorPublicProfile>(`/consult/doctors/${id}`).then(data),
    slots: (doctorId: string) => api.get<Slot[]>(`/consult/doctors/${doctorId}/slots`).then(data),
    /** What a promo code takes off this slot's fee. Nothing is used up. */
    checkPromo: (code: string, slotId: string) => api.post<ConsultPromoQuote>('/consult/promos/check', { code, slotId }).then(data),
    /** Codes this patient can use with this doctor now. */
    promos: (doctorId: string) => api.get<ConsultPromoQuote[]>('/consult/promos', { params: { doctorId } }).then(data),
    createBooking: (body: { slotId: string; patientId: string; idempotencyKey: string; useWallet?: boolean; expectedWalletPaise?: number; promoCode?: string; expectedDiscountPaise?: number; shareRecord?: boolean }) =>
        api.post<CreateBookingResponse>('/consult/bookings', {
            ...body,
            ...(body.shareRecord !== undefined ? { shareConsentVersion: RECORD_SHARE_VERSION, channel: 'web' } : {}),
        }).then(data),
    /** "Let the doctor see my health record" on this booking, on or off. */
    setRecordSharing: (id: string, share: boolean) =>
        api.put<RecordSharing>(`/consult/bookings/${id}/record-sharing`, { share, consentVersion: RECORD_SHARE_VERSION, channel: 'web' }).then(data),
    bookings: () => api.get<BookingView[]>('/consult/bookings').then(data),
    booking: (id: string) => api.get<BookingView>(`/consult/bookings/${id}`, { timeout: 10_000 }).then(data),
    verify: (id: string, body: { razorpay_order_id?: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        api.post<VerifyResponse>(`/consult/bookings/${id}/verify`, body).then(data),
    cancelPreview: (id: string) => api.get<CancelPreview>(`/consult/bookings/${id}/cancel-preview`).then(data),
    cancel: (id: string, reason?: string) => api.post<CancelResult>(`/consult/bookings/${id}/cancel`, { reason }).then(data),
    /** Moves the booking to another free time of the same doctor, within its rules. */
    changeTime: (id: string, newSlotId: string) => api.post<BookingView>(`/consult/bookings/${id}/change-time`, { newSlotId }).then(data),
    /** `consent` false: no tick shown, because sign-up consent covers this join (the server re-checks). */
    join: (id: string, consent: boolean) =>
        api.post<JoinResponse>(`/consult/bookings/${id}/join`, consent ? { consent, consentVersion: CONSENT_VERSION, channel: 'web' } : {}).then(data),
    prescription: (id: string) => api.get<Prescription>(`/consult/bookings/${id}/prescription`).then(data),
    downloadPrescription: (id: string) =>
        downloadAuthenticatedFile(`/consult/bookings/${id}/prescription.pdf`, 'docnow-prescription.pdf'),
    addTestsToCart: (id: string) => api.post<CartAddResult>(`/consult/bookings/${id}/recommended-tests/cart`).then(data),
};

// ── Medical records vault (per person) ──────────────────

export const records = {
    list: (patientId: string) => api.get<{ documents: PatientDocument[]; max: number }>(`/consult/records/${patientId}/documents`).then(data),
    upload: (patientId: string, file: File) => {
        const form = new FormData();
        form.append('file', file, file.name);
        return api.post<PatientDocument>(`/consult/records/${patientId}/documents`, form, { timeout: 60_000 }).then(data);
    },
    remove: (id: string) => api.delete<{ id: string; removed: boolean }>(`/consult/records/documents/${id}`).then(data),
};

// ── Doctor ──────────────────────────────────────────────

export const doctor = {
    me: () => api.get<DoctorMe>('/doctor/me').then(data),
    register: (body: DoctorProfileInput) => api.post<DoctorMe>('/doctor/register', body).then(data),
    resubmit: (body: DoctorProfileInput) => api.post<DoctorMe>('/doctor/resubmit', body).then(data),
    /** Gender saves at once; bio, languages and experience come back as a pending `request` (null: nothing changed). */
    updateMe: (body: { gender?: DoctorGender; bio?: string; languages?: string[]; experienceYears?: number }) =>
        api.patch<{ doctor: DoctorMe; request: DoctorChangeRequest | null }>('/doctor/me', body).then(data),
    uploadPhoto: (photo: Blob) => {
        const form = new FormData();
        form.append('photo', photo, 'photo.jpg');
        return api.post<{ photoUrl: string }>('/doctor/me/photo', form).then(data);
    },
    /** New hours wait for a super admin. `request` is null when they match the live hours (nothing to approve). */
    setAvailability: (windows: AvailabilityWindow[], slotMinutes?: number) =>
        api.put<{ request: DoctorChangeRequest | null }>('/doctor/me/availability', { windows, slotMinutes }).then(data),
    withdrawChange: (id: string) => api.delete(`/doctor/me/changes/${id}`).then(data),
    leave: () => api.get<LeaveEntry[]>('/doctor/me/leave').then(data),
    addLeave: (body: { startsAt: string; endsAt: string; reason?: string }) =>
        api.post<{ leave: LeaveEntry; bookedConflicts: number }>('/doctor/me/leave', body).then(data),
    removeLeave: (id: string) => api.delete(`/doctor/me/leave/${id}`).then(data),
    /** `q` is part of the patient's name; `from` and `to` are IST days (YYYY-MM-DD), both included. */
    consultations: (scope: 'upcoming' | 'past', cursor?: string, filters: { q?: string; from?: string; to?: string } = {}) =>
        api.get<DoctorConsultationPage>('/doctor/me/consultations', {
            params: { scope, cursor, q: filters.q?.trim() || undefined, from: filters.from || undefined, to: filters.to || undefined },
        }).then(data),
    consultation: (id: string) => api.get<DoctorConsultationRecord>(`/doctor/me/consultations/${id}`).then(data),
    /** The patient's whole record, when they shared it for this booking. Every call is logged. */
    sharedRecord: (id: string) => api.get<SharedRecord>(`/doctor/me/consultations/${id}/record`).then(data),
    /** A short link to one file or report of the shared record; each open is logged. */
    openSharedItem: (id: string, kind: SharedItemKind, targetId: string) =>
        api.get<SharedItemLink>(`/doctor/me/consultations/${id}/record/${kind}/${targetId}`).then(data),
    join: (id: string) => api.post<JoinResponse>(`/doctor/me/consultations/${id}/join`).then(data),
    end: (id: string) => api.post<{ status: ConsultationStatus }>(`/doctor/me/consultations/${id}/end`).then(data),
    saveNotes: (id: string, body: NoteInput) => api.put<ConsultNote>(`/doctor/me/consultations/${id}/notes`, body).then(data),
    issuePrescription: (id: string, body: PrescriptionInput) =>
        api.post<Prescription>(`/doctor/me/consultations/${id}/prescription`, body).then(data),
    reissuePrescription: (id: string, body: { reason: string; prescription: PrescriptionInput }) =>
        api.post<Prescription>(`/doctor/me/consultations/${id}/prescription/reissue`, body).then(data),
    downloadPrescription: (id: string) =>
        downloadAuthenticatedFile(`/doctor/me/consultations/${id}/prescription.pdf`, 'docnow-prescription.pdf'),
};

// ── Manager ─────────────────────────────────────────────

export const manager = {
    attendance: (range: { from: string; to: string }) =>
        api.get<AttendanceReport>('/manager/consult/attendance', { params: range }).then(data),
    downloadAttendanceCsv: (range: { from: string; to: string }) =>
        downloadAuthenticatedFile(`/manager/consult/attendance.csv?${new URLSearchParams(range)}`, `consult-no-shows-${range.from}-to-${range.to}.csv`),
};

// ── Admin ───────────────────────────────────────────────

export const admin = {
    doctors: (status?: string) => api.get<AdminDoctor[]>('/admin/consult/doctors', { params: status ? { status } : undefined }).then(data),
    doctor: (id: string) => api.get<AdminDoctor>(`/admin/consult/doctors/${id}`).then(data),
    /** The photo is required: an admin-created doctor is live at once. */
    createDoctor: (body: DoctorProfileInput & { mobile: string; consultationFee: number; slotMinutes: number }, photo: Blob) => {
        const form = new FormData();
        form.append('data', JSON.stringify(body));
        form.append('photo', photo, 'photo.jpg');
        return api.post<AdminDoctor>('/admin/consult/doctors', form).then(data);
    },
    uploadDoctorPhoto: (id: string, photo: Blob) => {
        const form = new FormData();
        form.append('photo', photo, 'photo.jpg');
        return api.post<{ photoUrl: string }>(`/admin/consult/doctors/${id}/photo`, form).then(data);
    },
    updateDoctor: (id: string, body: Partial<DoctorProfileInput> & { consultationFee?: number; slotMinutes?: number }) =>
        api.patch<AdminDoctor>(`/admin/consult/doctors/${id}`, body).then(data),
    approve: (id: string) => api.post<AdminDoctor>(`/admin/consult/doctors/${id}/approve`).then(data),
    doctorChanges: (status: DoctorChangeStatus = 'PENDING') =>
        api.get<DoctorChangeQueue>('/admin/consult/doctor-changes', { params: { status } }).then(data),
    approveChange: (id: string) =>
        api.post<{ id: string; status: DoctorChangeStatus; bookedKeptOutsideHours: number }>(`/admin/consult/doctor-changes/${id}/approve`).then(data),
    rejectChange: (id: string, reason: string) =>
        api.post<{ id: string; status: DoctorChangeStatus }>(`/admin/consult/doctor-changes/${id}/reject`, { reason }).then(data),
    reject: (id: string, reason: string) => api.post<AdminDoctor>(`/admin/consult/doctors/${id}/reject`, { reason }).then(data),
    suspend: (id: string, reason: string) => api.post<AdminDoctor>(`/admin/consult/doctors/${id}/suspend`, { reason }).then(data),
    specialties: () => api.get<Specialty[]>('/admin/consult/specialties').then(data),
    createSpecialty: (body: { name: string; description?: string; isActive?: boolean }) =>
        api.post<Specialty>('/admin/consult/specialties', body).then(data),
    updateSpecialty: (id: string, body: { name?: string; description?: string; isActive?: boolean }) =>
        api.patch<Specialty>(`/admin/consult/specialties/${id}`, body).then(data),
    policy: () => api.get<PolicyResponse>('/admin/consult/policy').then(data),
    savePolicy: (rules: ConsultRules, reason: string) => api.put('/admin/consult/policy', { rules, reason }).then(data),
    review: () => api.get<ReviewQueue>('/admin/consult/review').then(data),
    resolve: (consultationId: string, action: 'confirm' | 'refund', reason: string) =>
        api.post<{ outcome: string }>(`/admin/consult/review/consultations/${consultationId}/resolve`, { action, reason }).then(data),
    retryRefund: (refundId: string, reason: string) =>
        api.post<{ outcome: string }>(`/admin/consult/review/refunds/${refundId}/retry`, { reason }).then(data),
    cancelConsultation: (consultationId: string, reason: string) =>
        api.post<CancelResult>(`/admin/consult/consultations/${consultationId}/cancel`, { reason }).then(data),
    appointments: (q: { date: string; status?: string; doctorId?: string }) =>
        api.get<{ date: string; items: AdminAppointment[] }>('/admin/consult/appointments', {
            params: { date: q.date, status: q.status || undefined, doctorId: q.doctorId || undefined },
        }).then(data),
    appointment: (id: string) => api.get<AdminAppointmentDetail>(`/admin/consult/appointments/${id}`).then(data),
};
