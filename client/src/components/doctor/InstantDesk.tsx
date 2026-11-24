'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PhoneIncoming, Zap } from 'lucide-react';
import { Button } from '@/components/ui';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { formatCountdown } from '@/lib/consult/bookingFlow';
import { formatPaise } from '@/lib/consult/format';
import { DOCTOR_CHECK_IN_MS, offlineReasonText, onlineFor, patientLine, ringShareLeft, secondsLeft } from '@/lib/consult/instant';
import { serverNow } from '@/lib/consult/time';
import type { DoctorInstantState } from '@/lib/consult/types';
import { cn } from '@/lib/utils';

/** A two-tone ring, made in the browser: no sound file to ship. Needs a context unlocked by a click. */
function playRing(ctx: AudioContext) {
    const t = ctx.currentTime;
    for (const [offset, freq] of [[0, 880], [0.25, 660], [0.6, 880], [0.85, 660]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, t + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.22);
    }
}

/**
 * Instant consults in the doctor panel (P10), on every page: the online switch, the panel's
 * check-in every few seconds (which keeps the doctor online and is how a ring arrives), the ring
 * itself with sound and a 60 s bar, and "patient paid, join now". General Physicians only.
 */
export function InstantDesk() {
    const router = useRouter();
    const pathname = usePathname();
    const [state, setState] = useState<DoctorInstantState | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(() => serverNow());
    const audio = useRef<AudioContext | null>(null);
    const opened = useRef<string | null>(null);

    useEffect(() => {
        doctorApi.instantState().then(setState).catch(() => setState(null));
    }, []);

    const online = !!state?.online;
    const waiting = !!state?.accepted || !!state?.toJoin;
    // Online: check in (keeps the doctor online, brings rings). Offline but a patient is paying: just watch.
    useEffect(() => {
        if (!online && !waiting) return;
        let alive = true;
        const tick = () => {
            const call = online ? doctorApi.checkIn() : doctorApi.instantState();
            call.then((s) => { if (alive) { setState(s); setError(null); } }).catch(() => { /* the next check-in tries again */ });
        };
        const t = setInterval(tick, DOCTOR_CHECK_IN_MS);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [online, waiting]);

    const ring = state?.ring ?? null;
    // Keyed on ids: every check-in brings new objects, and the sound must not restart each time.
    const ringId = ring?.id ?? null;
    const acceptedId = state?.accepted?.id ?? null;
    // A one-second clock while something is counting down.
    useEffect(() => {
        if (!ringId && !acceptedId) return;
        const t = setInterval(() => setNow(serverNow()), 1000);
        return () => clearInterval(t);
    }, [ringId, acceptedId]);

    // Ringing: sound every 2 s and a flashing tab title, until it is answered or runs out.
    useEffect(() => {
        if (!ringId) return;
        const title = document.title;
        let flip = false;
        const beat = () => {
            if (audio.current && audio.current.state !== 'closed') {
                void audio.current.resume().then(() => playRing(audio.current!)).catch(() => {});
            }
            flip = !flip;
            document.title = flip ? 'Patient waiting' : title;
        };
        beat();
        const t = setInterval(beat, 2000);
        return () => {
            clearInterval(t);
            document.title = title;
        };
    }, [ringId]);

    // Paid: open the consultation page once, where the doctor joins as for any booking.
    const toJoin = state?.toJoin?.consultationId ?? null;
    useEffect(() => {
        if (!toJoin || opened.current === toJoin) return;
        opened.current = toJoin;
        const target = `/doctor/consultations/${toJoin}`;
        if (pathname !== target) router.push(target);
    }, [toJoin, pathname, router]);

    const act = useCallback(async (fn: () => Promise<DoctorInstantState>) => {
        setBusy(true);
        setError(null);
        try {
            setState(await fn());
        } catch (e) {
            setError(errorMessage(e));
            doctorApi.instantState().then(setState).catch(() => {});
        } finally {
            setBusy(false);
        }
    }, []);

    if (!state?.eligible) return null;

    const toggle = () => {
        // The click is what lets the browser play the ring later.
        if (!online && !audio.current && typeof window !== 'undefined' && 'AudioContext' in window) {
            try { audio.current = new AudioContext(); } catch { /* no sound; the screen still shows the ring */ }
        }
        void audio.current?.resume().catch(() => {});
        void act(() => doctorApi.setOnline(!online));
    };
    const reason = offlineReasonText(state.offlineReason);
    const label = !online ? 'Offline' : state.inConsult ? 'In a consult' : state.bookedSoon ? 'Online · booked patient due soon' : `Online · ${onlineFor(state.onlineSince, now)}`;
    const amber = online && (state.inConsult || !!state.bookedSoon);

    return (
        <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm">
                <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-bold text-foreground"><Zap className="h-4 w-4 text-primary" aria-hidden /> Instant consults</p>
                    <p className="text-xs text-muted-foreground">
                        {online ? 'Keep this page open with sound on. You go offline when you close it.' : 'Switch on to be rung when a patient wants a Doc now.'}
                    </p>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={online}
                    disabled={busy}
                    onClick={toggle}
                    className={cn(
                        'inline-flex min-h-11 items-center gap-2 rounded-full border px-2 py-1 pr-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60',
                        amber ? 'border-amber-600 bg-amber-50 text-amber-800' : online ? 'border-green-700 bg-green-50 text-green-800' : 'border-border text-gray-700',
                    )}
                >
                    <span className={cn('relative h-6 w-10 rounded-full transition-colors', online ? (amber ? 'bg-amber-600' : 'bg-green-700') : 'bg-gray-300')} aria-hidden>
                        <span className={cn('absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all', online ? 'left-5' : 'left-1')} />
                    </span>
                    {label}
                </button>
            </div>
            {reason && !online && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{reason}</p>}
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-destructive">{error}</p>}

            {state.accepted && !state.accepted.paid && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" aria-live="polite">
                    <p className="font-bold">Waiting for {state.accepted.patientName} to pay · <span className="font-mono tabular-nums">{formatCountdown(secondsLeft(state.accepted.payBy, now))}</span></p>
                    <p className="mt-1">{patientLine(state.accepted.patientAge, state.accepted.patientGender)} · {state.accepted.reason}</p>
                    <p className="mt-1 text-amber-800">The consultation opens here once they pay. If they don&apos;t, you&apos;re back online for others.</p>
                </div>
            )}
            {state.toJoin && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-green-300 bg-green-50 p-4 text-sm text-green-900" aria-live="polite">
                    <p><b>{state.toJoin.patientName} has paid.</b> {state.toJoin.reason}</p>
                    <Link href={`/doctor/consultations/${state.toJoin.consultationId}`} className="inline-flex min-h-11 items-center rounded-xl bg-green-700 px-4 font-semibold text-white hover:bg-green-800">
                        Join now
                    </Link>
                </div>
            )}

            {ring && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="ring-title" aria-describedby="ring-body">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-4 ring-green-200">
                        <div className="flex items-center justify-between gap-3">
                            <h2 id="ring-title" className="flex items-center gap-2 text-lg font-bold text-foreground">
                                <PhoneIncoming className="h-5 w-5 text-green-700" aria-hidden /> Instant consult request
                            </h2>
                            <span className="font-mono text-lg font-bold tabular-nums text-green-800">{formatCountdown(secondsLeft(ring.ringExpiresAt, now, 60))}</span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-200" aria-hidden>
                            <div className="h-full bg-green-700 transition-[width] duration-1000 ease-linear" style={{ width: `${ringShareLeft(ring.ringExpiresAt, now) * 100}%` }} />
                        </div>
                        <dl id="ring-body" className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                            <dt className="text-muted-foreground">Patient</dt><dd className="font-semibold">{patientLine(ring.patientAge, ring.patientGender)}</dd>
                            <dt className="text-muted-foreground">Reason</dt><dd>{ring.reason}</dd>
                            <dt className="text-muted-foreground">Allergies</dt>
                            <dd className={cn(ring.allergies.length > 0 && 'font-semibold text-destructive')}>
                                {ring.allergies.length > 0 ? ring.allergies.join(', ') : ring.allergiesConfirmed ? 'None known' : 'Not asked yet'}
                            </dd>
                            {ring.feePaise !== null && <><dt className="text-muted-foreground">Fee</dt><dd>{formatPaise(ring.feePaise)} (your fee)</dd></>}
                        </dl>
                        <div className="mt-5 grid grid-cols-2 gap-3">
                            <Button size="lg" className="bg-green-700 hover:bg-green-800" loading={busy} onClick={() => void act(() => doctorApi.acceptInstant(ring.id))}>Accept</Button>
                            <Button size="lg" variant="outline" disabled={busy} onClick={() => void act(() => doctorApi.declineInstant(ring.id))}>Decline</Button>
                        </div>
                        <p className="mt-3 text-center text-xs text-muted-foreground">The patient&apos;s name shows after you accept. They pay first, then you join.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
