import type { InstantOnlineState } from './types';

type Tone = 'success' | 'warning' | 'info' | 'muted' | 'danger';

/** Admin labels for an online GP. Everything but FREE is a doctor the matcher won't ring now. */
export const ONLINE_STATE: Record<InstantOnlineState, { label: string; tone: Tone; hint: string }> = {
    FREE: { label: 'Free', tone: 'success', hint: 'Can be rung now' },
    RINGING: { label: 'Ringing', tone: 'warning', hint: 'Being asked to take a patient' },
    WAITING_PAYMENT: { label: 'Waiting for payment', tone: 'info', hint: 'Accepted; the patient is paying' },
    IN_CALL: { label: 'In a call', tone: 'info', hint: 'In a consultation now' },
    SCHEDULED_SOON: { label: 'Booked consult due', tone: 'muted', hint: 'A booked consultation starts soon, so not rung' },
};

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
    SEARCHING: { label: 'Looking for a Doc', tone: 'warning' },
    RINGING: { label: 'Ringing a Doc', tone: 'warning' },
    ACCEPTED: { label: 'Accepted, waiting for payment', tone: 'info' },
    BOOKED: { label: 'Paid and booked', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'muted' },
    NO_MATCH: { label: 'No Doc found', tone: 'danger' },
    UNPAID: { label: 'Not paid in time', tone: 'muted' },
};

/** "45 s", "12 min", "3 h 05 min". */
export function formatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Hours with one decimal, for payroll-style totals: 5400 s → "1.5". */
export const formatHours = (seconds: number) => (Math.round(seconds / 360) / 10).toFixed(1);

/** The hours endpoint's limit (PRESENCE_MAX_DAYS on the server). */
export const PRESENCE_MAX_DAYS = 93;

/** Days in an inclusive YYYY-MM-DD range. */
export const daysInRange = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** YYYY-MM-DD of an instant in IST, and the day `days` before it. */
export function istDay(d: Date, daysBack = 0): string {
    return new Date(d.getTime() + 330 * 60_000 - daysBack * 86_400_000).toISOString().slice(0, 10);
}
