/**
 * Pure rules for the booking and payment screens. The server's booking state is the truth: nothing
 * here ever calls a payment "failed" while it may have gone through.
 */
import type { BookingView, ConsultationStatus, VerifyOutcome } from './types';

export const POLL_INTERVAL_MS = 3000;
export const CONFIRM_WINDOW_MS = 60_000;
export const EXPIRED_GRACE_MS = 120_000;

export type ResultKind = 'booked' | 'refund' | 'checking' | 'hold_ended' | 'still_confirming' | 'closed';

export type Decision =
    | { kind: 'pay' }
    | { kind: 'poll' }
    | { kind: 'result'; result: ResultKind };

export interface DecideContext {
    /** Server-corrected time in ms. */
    nowMs: number;
    /** When we began waiting on a payment (popup success or a captured payment seen), or null. */
    confirmStartedAt: number | null;
}

const BOOKED: ConsultationStatus[] = ['CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED'];

/** What the screen should do next, from the booking the server last returned. */
export function decide(view: BookingView, ctx: DecideContext): Decision {
    const { status } = view;
    if (BOOKED.includes(status)) return { kind: 'result', result: 'booked' };
    if (status === 'REFUNDED') return { kind: 'result', result: view.refundPaise > 0 ? 'refund' : 'closed' };
    if (status === 'CANCELLED' || status === 'NO_SHOW_PATIENT' || status === 'NO_SHOW_DOCTOR') {
        return { kind: 'result', result: 'closed' };
    }
    if (status === 'EXPIRED' && view.refundPaise > 0) return { kind: 'result', result: 'refund' };
    if (view.underStaffCheck) return { kind: 'result', result: 'checking' };

    const confirming = ctx.confirmStartedAt !== null || view.paymentCaptured;
    if (confirming) {
        const started = ctx.confirmStartedAt ?? ctx.nowMs;
        return ctx.nowMs - started >= CONFIRM_WINDOW_MS ? { kind: 'result', result: 'still_confirming' } : { kind: 'poll' };
    }

    const holdEnd = Date.parse(view.holdExpiresAt);
    if (status === 'PENDING_PAYMENT' && ctx.nowMs < holdEnd) return { kind: 'pay' };
    // A late payment can still confirm an expired hold, so wait before calling it over.
    return ctx.nowMs - holdEnd < EXPIRED_GRACE_MS ? { kind: 'poll' } : { kind: 'result', result: 'hold_ended' };
}

/** The verify reply can show a settled outcome early. Other outcomes wait for the booking to confirm. */
export function applyVerifyHint(decision: Decision, outcome: VerifyOutcome | null): Decision {
    if (decision.kind === 'result' || !outcome) return decision;
    if (outcome === 'refund_created') return { kind: 'result', result: 'refund' };
    if (outcome === 'flagged') return { kind: 'result', result: 'checking' };
    return decision;
}

export type CreateErrorAction =
    | { kind: 'slot_taken'; forgetKey: true }
    | { kind: 'ended'; forgetKey: true }
    | { kind: 'busy'; forgetKey: true }
    | { kind: 'setting_up'; forgetKey: false }
    | { kind: 'too_many'; forgetKey: false }
    | { kind: 'login'; forgetKey: false }
    | { kind: 'other'; forgetKey: false };

/** Maps a failed create call to the next step. A new key is needed once the old booking is dead. */
export function mapCreateError(status: number | undefined, message?: string): CreateErrorAction {
    if (status === 409) {
        if (/has ended/i.test(message ?? '')) return { kind: 'ended', forgetKey: true };
        if (/being set up/i.test(message ?? '')) return { kind: 'setting_up', forgetKey: false };
        return { kind: 'slot_taken', forgetKey: true };
    }
    if (status === 429) return { kind: 'too_many', forgetKey: false };
    if (status === 502) return { kind: 'busy', forgetKey: true };
    if (status === 401) return { kind: 'login', forgetKey: false };
    return { kind: 'other', forgetKey: false };
}

export const ANNOUNCE_AT_SECONDS = [300, 60, 0] as const;

/** The countdown threshold crossed between two readings, so screen readers hear it only then. */
export function announceThreshold(previous: number | null, current: number): number | null {
    if (previous === null) return null;
    for (const t of ANNOUNCE_AT_SECONDS) {
        if (previous > t && current <= t) return t;
    }
    return null;
}

export function formatCountdown(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export interface BookingGroups {
    upcoming: BookingView[];
    unpaid: BookingView[];
    past: BookingView[];
}

/** Splits bookings for the My consultations page. Anything paid but not yet settled stays in upcoming. */
export function groupBookings(bookings: BookingView[], nowMs: number): BookingGroups {
    const upcoming: BookingView[] = [];
    const unpaid: BookingView[] = [];
    const past: BookingView[] = [];
    for (const b of bookings) {
        const live = BOOKED.includes(b.status) && b.status !== 'COMPLETED';
        const unsettled = (b.status === 'PENDING_PAYMENT' || b.status === 'EXPIRED') && (b.paymentCaptured || b.underStaffCheck);
        if ((live && Date.parse(b.endsAt) > nowMs) || unsettled) upcoming.push(b);
        else if (b.status === 'PENDING_PAYMENT' && Date.parse(b.holdExpiresAt) > nowMs) unpaid.push(b);
        else past.push(b);
    }
    const byStart = (a: BookingView, b: BookingView) => Date.parse(a.startsAt) - Date.parse(b.startsAt);
    upcoming.sort(byStart);
    unpaid.sort((a, b) => Date.parse(a.holdExpiresAt) - Date.parse(b.holdExpiresAt));
    past.sort((a, b) => byStart(b, a));
    return { upcoming, unpaid, past };
}

// ── Saved booking, so a paid booking can be found again after a reload ─────────

const SAVED_KEY = 'consult-active-booking';

export interface SavedBooking {
    id: string;
    slotId: string;
    patientId: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): Store | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

export function saveBooking(saved: SavedBooking, store: Store | null = defaultStore()) {
    try {
        store?.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
        /* storage blocked: My consultations still lists the booking */
    }
}

export function loadSavedBooking(store: Store | null = defaultStore()): SavedBooking | null {
    try {
        const raw = store?.getItem(SAVED_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<SavedBooking>;
        return parsed.id && parsed.slotId && parsed.patientId ? (parsed as SavedBooking) : null;
    } catch {
        return null;
    }
}

export function clearSavedBooking(store: Store | null = defaultStore()) {
    try {
        store?.removeItem(SAVED_KEY);
    } catch {
        /* nothing to clear */
    }
}

/** Results after which the saved booking is no longer needed and its key must not be reused. */
export function isFinalResult(result: ResultKind): boolean {
    return result === 'booked' || result === 'refund' || result === 'closed' || result === 'hold_ended';
}
