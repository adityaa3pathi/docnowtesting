/**
 * Pure rules for "Consult a Doc now" (P10). The server's request state is the truth; these only
 * turn it into what each screen says. Times come from the server clock (serverNow), never the device.
 */
import { formatCountdown } from './bookingFlow';
import { formatPaise } from './format';
import type { InstantAvailability, InstantStatus, InstantView } from './types';

/** How often the waiting screen asks for news, and the doctor panel checks in. */
export const INSTANT_POLL_MS = 2500;
export const DOCTOR_CHECK_IN_MS = 3000;
/** From this long into a search, the emergency line shows. */
export const EMERGENCY_HINT_AFTER_MS = 3 * 60_000;
export const REASON_MAX = 200;

export type InstantScreen = 'searching' | 'pay' | 'booked' | 'ended';

export function instantScreen(status: InstantStatus): InstantScreen {
    if (status === 'SEARCHING') return 'searching';
    if (status === 'ACCEPTED') return 'pay';
    if (status === 'BOOKED') return 'booked';
    return 'ended';
}

/** Minutes and seconds since the search began, never negative. */
export function elapsed(createdAt: string, now: number): string {
    return formatCountdown(Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000)));
}

/** Seconds left until a time, never negative, and never more than `max` (the clocks can differ by a second or two). */
export function secondsLeft(until: string | null, now: number, max = Infinity): number {
    if (!until) return 0;
    return Math.min(max, Math.max(0, Math.ceil((Date.parse(until) - now) / 1000)));
}

/** "₹350", or "₹300 to ₹450" when online doctors charge different fees. */
export function feeRange(a: Pick<InstantAvailability, 'feeMinPaise' | 'feeMaxPaise'>): string | null {
    if (a.feeMinPaise === null || a.feeMaxPaise === null) return null;
    return a.feeMinPaise === a.feeMaxPaise ? formatPaise(a.feeMinPaise) : `${formatPaise(a.feeMinPaise)} to ${formatPaise(a.feeMaxPaise)}`;
}

export const docsOnline = (n: number) => (n === 1 ? '1 Doc online now' : `${n} Docs online now`);

const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** The line under the timer: who is free, or where the patient is in line when every Doc is busy. */
export function queueLine(v: Pick<InstantView, 'position' | 'doctorsOnline' | 'doctorsFree' | 'asking'>): string {
    if (v.asking) return 'Asking an available Doc now.';
    if (v.doctorsOnline === 0) return 'No Doc is online at the moment. We keep looking until the time is up.';
    if ((v.doctorsFree ?? 0) > 0 && (v.position ?? 1) <= 1) return 'Asking an available Doc now.';
    const place = v.position ? `You're ${ordinal(v.position)} in line.` : '';
    return `All Docs are on calls. ${place} We'll connect you to the next Doc who's free.`.replace(/\s+/g, ' ').trim();
}

/** What an ended request says. Nothing was charged in any of these. */
export function endedCopy(status: InstantStatus): { title: string; body: string } {
    if (status === 'NO_MATCH') return { title: 'No Doc is free right now', body: 'We tried for 10 minutes. Nothing was charged.' };
    if (status === 'UNPAID') return { title: 'The time to pay ran out', body: 'The doctor has been freed for other patients. Nothing was charged.' };
    return { title: 'You stopped looking', body: 'Nothing was charged.' };
}

export function cleanReason(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
}

// ── Doctor panel ──

/** Why the panel says a doctor went offline when they did not switch off themselves. */
export function offlineReasonText(reason: string | null): string | null {
    if (reason === 'MISSED_RINGS') return 'You missed 2 requests in a row, so we set you offline.';
    if (reason === 'TIMEOUT') return 'You went offline because this page was closed or lost its connection.';
    return null;
}

/** Share of the 60 s ring left, 0 to 1, for the bar. */
export function ringShareLeft(ringExpiresAt: string, now: number, ringMs = 60_000): number {
    return Math.min(1, Math.max(0, (Date.parse(ringExpiresAt) - now) / ringMs));
}

export function patientLine(age: number, gender: string): string {
    const g = /^f/i.test(gender) ? 'Female' : /^m/i.test(gender) ? 'Male' : gender || 'Patient';
    return `${g}, ${age}`;
}

/** "12 min", "1 h 5 min": how long the doctor has been online. */
export function onlineFor(since: string | null, now: number): string {
    if (!since) return '';
    const min = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
