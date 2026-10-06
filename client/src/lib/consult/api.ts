/** One typed call per consultation route, so screens never write raw URLs. */
import type { AxiosResponse } from 'axios';
import api from '@/lib/api';
import { recordServerDate } from './time';
import type {
    AdminDoctor, AvailabilityWindow, BookingView, CancelPreview, CancelResult, ConsultRules, CreateBookingResponse,
    DoctorMe, DoctorProfileInput, DoctorPublicProfile, DoctorSummary, LeaveEntry, PolicyResponse, ReviewQueue,
    Slot, Specialty, VerifyResponse,
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

// ── Patient ─────────────────────────────────────────────

export const consult = {
    specialties: () => api.get<Specialty[]>('/consult/specialties').then(data),
    doctors: (specialtyId?: string) =>
        api.get<DoctorSummary[]>('/consult/doctors', { params: specialtyId ? { specialtyId } : undefined }).then(data),
    doctor: (id: string) => api.get<DoctorPublicProfile>(`/consult/doctors/${id}`).then(data),
    slots: (doctorId: string) => api.get<Slot[]>(`/consult/doctors/${doctorId}/slots`).then(data),
    createBooking: (body: { slotId: string; patientId: string; idempotencyKey: string }) =>
        api.post<CreateBookingResponse>('/consult/bookings', body).then(data),
    bookings: () => api.get<BookingView[]>('/consult/bookings').then(data),
    booking: (id: string) => api.get<BookingView>(`/consult/bookings/${id}`, { timeout: 10_000 }).then(data),
    verify: (id: string, body: { razorpay_order_id?: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        api.post<VerifyResponse>(`/consult/bookings/${id}/verify`, body).then(data),
    cancelPreview: (id: string) => api.get<CancelPreview>(`/consult/bookings/${id}/cancel-preview`).then(data),
    cancel: (id: string, reason?: string) => api.post<CancelResult>(`/consult/bookings/${id}/cancel`, { reason }).then(data),
};

// ── Doctor ──────────────────────────────────────────────

export const doctor = {
    me: () => api.get<DoctorMe>('/doctor/me').then(data),
    register: (body: DoctorProfileInput) => api.post<DoctorMe>('/doctor/register', body).then(data),
    resubmit: (body: DoctorProfileInput) => api.post<DoctorMe>('/doctor/resubmit', body).then(data),
    setAvailability: (windows: AvailabilityWindow[], slotMinutes?: number) =>
        api.put<AvailabilityWindow[]>('/doctor/me/availability', { windows, slotMinutes }).then(data),
    leave: () => api.get<LeaveEntry[]>('/doctor/me/leave').then(data),
    addLeave: (body: { startsAt: string; endsAt: string; reason?: string }) =>
        api.post<{ leave: LeaveEntry; bookedConflicts: number }>('/doctor/me/leave', body).then(data),
    removeLeave: (id: string) => api.delete(`/doctor/me/leave/${id}`).then(data),
};

// ── Admin ───────────────────────────────────────────────

export const admin = {
    doctors: (status?: string) => api.get<AdminDoctor[]>('/admin/consult/doctors', { params: status ? { status } : undefined }).then(data),
    doctor: (id: string) => api.get<AdminDoctor>(`/admin/consult/doctors/${id}`).then(data),
    createDoctor: (body: DoctorProfileInput & { mobile: string; consultationFee: number; slotMinutes: number }) =>
        api.post<AdminDoctor>('/admin/consult/doctors', body).then(data),
    updateDoctor: (id: string, body: Partial<DoctorProfileInput> & { consultationFee?: number; slotMinutes?: number }) =>
        api.patch<AdminDoctor>(`/admin/consult/doctors/${id}`, body).then(data),
    approve: (id: string) => api.post<AdminDoctor>(`/admin/consult/doctors/${id}/approve`).then(data),
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
};
