import { describe, expect, it } from 'vitest';
import {
    afterVerifyError, announceThreshold, applyVerifyHint, clearSavedBooking, decide, groupBookings, loadSavedBooking,
    mapCreateError, saveBooking, EXPIRED_GRACE_MS, CONFIRM_WINDOW_MS,
} from './bookingFlow';
import type { BookingView } from './types';

const NOW = Date.parse('2026-10-07T10:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function booking(over: Partial<BookingView> = {}): BookingView {
    return {
        consultationId: 'c1', status: 'PENDING_PAYMENT', razorpayOrderId: 'order_1', amountPaise: 49900, currency: 'INR',
        keyId: 'rzp_test', holdExpiresAt: iso(10 * 60_000), startsAt: iso(86_400_000), endsAt: iso(86_400_000 + 1_800_000),
        doctorId: 'd1', doctorName: 'Dr A', specialty: 'General', patientId: 'p1', patientName: 'Asha',
        paymentCaptured: false, underStaffCheck: false, refundPaise: 0, refundStatus: null, ...over,
    };
}
const ctx = (nowMs = NOW, confirmStartedAt: number | null = null) => ({ nowMs, confirmStartedAt });

describe('decide', () => {
    it('shows the pay screen while the hold lasts and nothing is paid', () => {
        expect(decide(booking(), ctx())).toEqual({ kind: 'pay' });
    });

    it('happy path: confirmed booking is booked', () => {
        expect(decide(booking({ status: 'CONFIRMED' }), ctx(NOW, NOW))).toEqual({ kind: 'result', result: 'booked' });
    });

    it('popup closed with nothing paid returns to pay, not confirming', () => {
        expect(decide(booking(), ctx(NOW + 20_000, null))).toEqual({ kind: 'pay' });
    });

    it('keeps confirming after the popup reports a payment, then says still confirming at the limit', () => {
        const start = NOW;
        expect(decide(booking(), ctx(start + 30_000, start))).toEqual({ kind: 'poll' });
        expect(decide(booking(), ctx(start + CONFIRM_WINDOW_MS, start))).toEqual({ kind: 'result', result: 'still_confirming' });
    });

    it('verify timed out but the booking later reads CONFIRMED: ends booked, never failed', () => {
        expect(afterVerifyError()).toEqual({ kind: 'poll' });
        expect(decide(booking(), ctx(NOW + 3000, NOW))).toEqual({ kind: 'poll' });
        expect(decide(booking({ status: 'CONFIRMED', paymentCaptured: true }), ctx(NOW + 6000, NOW))).toEqual({ kind: 'result', result: 'booked' });
    });

    it('treats a captured payment as confirming even after a reload', () => {
        expect(decide(booking({ paymentCaptured: true }), ctx())).toEqual({ kind: 'poll' });
    });

    it('expired hold with nothing paid waits two minutes before hold ended', () => {
        const view = booking({ status: 'EXPIRED', holdExpiresAt: iso(0) });
        expect(decide(view, ctx(NOW + 1000))).toEqual({ kind: 'poll' });
        expect(decide(view, ctx(NOW + EXPIRED_GRACE_MS))).toEqual({ kind: 'result', result: 'hold_ended' });
    });

    it('a pending booking past its hold is polled, then final', () => {
        const view = booking({ holdExpiresAt: iso(0) });
        expect(decide(view, ctx(NOW + 5000))).toEqual({ kind: 'poll' });
        expect(decide(view, ctx(NOW + EXPIRED_GRACE_MS + 1))).toEqual({ kind: 'result', result: 'hold_ended' });
    });

    it('reads expired first and confirmed on a later poll: ends booked', () => {
        const expired = booking({ status: 'EXPIRED', holdExpiresAt: iso(0) });
        expect(decide(expired, ctx(NOW + 10_000)).kind).toBe('poll');
        expect(decide(booking({ status: 'CONFIRMED', holdExpiresAt: iso(0) }), ctx(NOW + 13_000))).toEqual({ kind: 'result', result: 'booked' });
    });

    it('a flagged booking shows the checking message after a reload', () => {
        expect(decide(booking({ underStaffCheck: true, paymentCaptured: true }), ctx())).toEqual({ kind: 'result', result: 'checking' });
    });

    it('expired with a refund shows the refund message', () => {
        expect(decide(booking({ status: 'EXPIRED', refundPaise: 49900 }), ctx())).toEqual({ kind: 'result', result: 'refund' });
    });

    it('closed states', () => {
        expect(decide(booking({ status: 'CANCELLED' }), ctx())).toEqual({ kind: 'result', result: 'closed' });
        expect(decide(booking({ status: 'REFUNDED', refundPaise: 100 }), ctx())).toEqual({ kind: 'result', result: 'refund' });
    });
});

describe('applyVerifyHint', () => {
    const polling = { kind: 'poll' } as const;
    it('refund created and flagged settle at once', () => {
        expect(applyVerifyHint(polling, 'refund_created')).toEqual({ kind: 'result', result: 'refund' });
        expect(applyVerifyHint(polling, 'flagged')).toEqual({ kind: 'result', result: 'checking' });
    });
    it('confirmed, reclaimed, already and unknown order keep waiting for the booking', () => {
        for (const o of ['confirmed', 'reclaimed', 'already', 'unknown_order'] as const) {
            expect(applyVerifyHint(polling, o)).toEqual(polling);
        }
    });
    it('never overrides a settled result', () => {
        const done = { kind: 'result', result: 'booked' } as const;
        expect(applyVerifyHint(done, 'flagged')).toEqual(done);
    });
});

describe('mapCreateError', () => {
    it('409 slot taken goes back to the picker and forgets the key', () => {
        expect(mapCreateError(409, 'That slot was just taken')).toEqual({ kind: 'slot_taken', forgetKey: true });
    });
    it('409 booking ended mints a new key', () => {
        expect(mapCreateError(409, 'This booking has ended. Start a new booking with a new idempotency key')).toEqual({ kind: 'ended', forgetKey: true });
    });
    it('409 still being set up keeps the same key', () => {
        expect(mapCreateError(409, 'This booking is still being set up. Try again in a moment')).toEqual({ kind: 'setting_up', forgetKey: false });
    });
    it('429 links to My consultations without changing the key', () => {
        expect(mapCreateError(429, 'Too many unpaid bookings')).toEqual({ kind: 'too_many', forgetKey: false });
    });
    it('502 mints a new key', () => {
        expect(mapCreateError(502)).toEqual({ kind: 'busy', forgetKey: true });
    });
    it('401 asks to log in; others are plain errors', () => {
        expect(mapCreateError(401).kind).toBe('login');
        expect(mapCreateError(500).kind).toBe('other');
        expect(mapCreateError(undefined).kind).toBe('other');
    });
});

describe('announceThreshold', () => {
    it('speaks only when a threshold is crossed', () => {
        expect(announceThreshold(null, 400)).toBeNull();
        expect(announceThreshold(301, 300)).toBe(300);
        expect(announceThreshold(299, 298)).toBeNull();
        expect(announceThreshold(61, 60)).toBe(60);
        expect(announceThreshold(1, 0)).toBe(0);
    });
});

describe('groupBookings', () => {
    it('groups by state', () => {
        const up = booking({ consultationId: 'up', status: 'CONFIRMED' });
        const unpaid = booking({ consultationId: 'unpaid' });
        const old = booking({ consultationId: 'old', status: 'COMPLETED', startsAt: iso(-86_400_000), endsAt: iso(-80_000_000) });
        const gone = booking({ consultationId: 'gone', holdExpiresAt: iso(-1000), status: 'EXPIRED' });
        const paidLate = booking({ consultationId: 'late', status: 'EXPIRED', paymentCaptured: true });
        const g = groupBookings([old, unpaid, up, gone, paidLate], NOW);
        expect(g.upcoming.map((b) => b.consultationId).sort()).toEqual(['late', 'up']);
        expect(g.unpaid.map((b) => b.consultationId)).toEqual(['unpaid']);
        expect(g.past.map((b) => b.consultationId).sort()).toEqual(['gone', 'old']);
    });
});

describe('saved booking', () => {
    function memory() {
        const m = new Map<string, string>();
        return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    }
    it('saves, loads and clears', () => {
        const s = memory();
        saveBooking({ id: 'c1', slotId: 's1', patientId: 'p1' }, s);
        expect(loadSavedBooking(s)).toEqual({ id: 'c1', slotId: 's1', patientId: 'p1' });
        clearSavedBooking(s);
        expect(loadSavedBooking(s)).toBeNull();
    });
    it('ignores broken data and missing storage', () => {
        const s = memory();
        s.setItem('consult-active-booking', '{oops');
        expect(loadSavedBooking(s)).toBeNull();
        expect(loadSavedBooking(null)).toBeNull();
    });
});
