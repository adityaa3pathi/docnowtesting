'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { consult, errorMessage, errorStatus } from '@/lib/consult/api';
import { secondsUntil, serverNow } from '@/lib/consult/time';
import { openCheckout, type PaymentResult } from '@/lib/razorpayCheckout';
import { forgetAttemptKey } from '@/lib/consult/idempotency';
import {
    LATE_WATCH_INTERVAL_MS, LATE_WATCH_MAX_TICKS, POLL_INTERVAL_MS, announceThreshold, applyVerifyHint, clearSavedBooking, decide,
    isFinalResult, loadSavedBooking, type Decision,
} from '@/lib/consult/bookingFlow';
import type { BookingView, VerifyOutcome } from '@/lib/consult/types';

const DISMISS_RECHECK_MS = [3000, 4000];

/** Drives one booking from the pay screen to a settled result. The server's booking is the truth. */
export function useBookingFlow(id: string, enabled: boolean) {
    const [booking, setBooking] = useState<BookingView | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ message: string; status?: number } | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [confirmStartedAt, setConfirmStartedAt] = useState<number | null>(null);
    const [hint, setHint] = useState<VerifyOutcome | null>(null);
    const [payNote, setPayNote] = useState<string | null>(null);
    const [opening, setOpening] = useState(false);
    const [announcement, setAnnouncement] = useState('');
    const alive = useRef(true);
    const lastSeconds = useRef<number | null>(null);
    const payInFlight = useRef(false);

    const load = useCallback(async () => {
        try {
            const view = await consult.booking(id);
            if (!alive.current) return null;
            setBooking(view);
            setError(null);
            return view;
        } catch (e) {
            if (alive.current) setError({ message: errorMessage(e), status: errorStatus(e) });
            if (errorStatus(e) === 404 && loadSavedBooking()?.id === id) clearSavedBooking();
            return null;
        } finally {
            if (alive.current) setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    useEffect(() => {
        if (enabled) void load();
    }, [enabled, load]);

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    const decision: Decision | null = useMemo(() => {
        if (!booking) return null;
        const base = decide(booking, { nowMs: serverNow(now), confirmStartedAt });
        return applyVerifyHint(base, hint);
    }, [booking, now, confirmStartedAt, hint]);

    // A payment seen on the server starts the 60 second confirming window.
    useEffect(() => {
        if (booking?.paymentCaptured && confirmStartedAt === null) setConfirmStartedAt(serverNow());
    }, [booking?.paymentCaptured, confirmStartedAt]);

    const polling = decision?.kind === 'poll';
    useEffect(() => {
        if (!polling) return;
        const t = setInterval(() => void load(), POLL_INTERVAL_MS);
        return () => clearInterval(t);
    }, [polling, load]);

    const result = decision?.kind === 'result' ? decision.result : null;

    // A late webhook can still settle these, so keep checking slowly for a while.
    const lateWatch = result === 'still_confirming' || result === 'hold_ended';
    useEffect(() => {
        if (!lateWatch) return;
        let ticks = 0;
        const t = setInterval(() => {
            ticks += 1;
            if (ticks > LATE_WATCH_MAX_TICKS) clearInterval(t);
            else void load();
        }, LATE_WATCH_INTERVAL_MS);
        return () => clearInterval(t);
    }, [lateWatch, load]);

    useEffect(() => {
        if (!result || !isFinalResult(result)) return;
        const saved = loadSavedBooking();
        if (saved?.id === id) {
            // A dead booking must not hand its key to the next attempt.
            if (result !== 'booked') forgetAttemptKey(saved.slotId, saved.patientId);
            clearSavedBooking();
        }
    }, [result, id]);

    const secondsLeft = booking ? secondsUntil(booking.holdExpiresAt, now) : 0;
    useEffect(() => {
        if (decision?.kind !== 'pay') {
            lastSeconds.current = null;
            return;
        }
        const crossed = announceThreshold(lastSeconds.current, secondsLeft);
        lastSeconds.current = secondsLeft;
        if (crossed === null) return;
        setAnnouncement(crossed === 0 ? 'Your hold has ended.' : `${crossed / 60} ${crossed === 60 ? 'minute' : 'minutes'} left to pay.`);
    }, [secondsLeft, decision?.kind]);

    const onPaid = useCallback(
        async (res: PaymentResult) => {
            setPayNote(null);
            setConfirmStartedAt(serverNow());
            try {
                const out = await consult.verify(id, res);
                if (alive.current) setHint(out.outcome);
            } catch {
                // A failed verify says nothing about the payment, so the load below decides.
            }
            await load();
        },
        [id, load]
    );

    const pay = useCallback(async () => {
        if (!booking || opening || payInFlight.current) return;
        payInFlight.current = true;
        setPayNote(null);
        const fresh = await load();
        if (!fresh) {
            payInFlight.current = false;
            setPayNote('We could not check your booking. Check your connection and try again.');
            return;
        }
        if (decide(fresh, { nowMs: serverNow(), confirmStartedAt }).kind !== 'pay') {
            payInFlight.current = false;
            return;
        }
        if (!fresh.razorpayOrderId || !fresh.keyId) {
            payInFlight.current = false;
            setPayNote('This booking is not ready for payment. Please try again in a moment.');
            return;
        }
        setOpening(true);
        const opened = await openCheckout({
            keyId: fresh.keyId,
            orderId: fresh.razorpayOrderId,
            amountPaise: fresh.amountPaise,
            description: `Consultation with ${fresh.doctorName}`,
            onPaid: (res) => void onPaid(res),
            onDismiss: () => {
                // Closing the popup proves nothing about payment, so ask the server a few times
                // before offering Pay again; a UPI payment can land after the popup closes.
                void (async () => {
                    for (const wait of DISMISS_RECHECK_MS) {
                        await load();
                        if (!alive.current) return;
                        await new Promise((r) => setTimeout(r, wait));
                    }
                    await load();
                    payInFlight.current = false;
                    if (alive.current) setOpening(false);
                })();
            },
            onFailed: () => {
                setPayNote('That attempt did not complete. You can try again while the hold lasts. If money was taken, it will show in My consultations.');
                void load();
            },
        });
        if (!opened) {
            payInFlight.current = false;
            setOpening(false);
            setPayNote('We could not open the payment window. Check your connection and try again.');
        }
    }, [booking, opening, load, confirmStartedAt, onPaid]);

    return {
        booking, loading, error, decision, secondsLeft, announcement, payNote, opening, paidHere: confirmStartedAt !== null, refetch: load, pay,
    };
}
