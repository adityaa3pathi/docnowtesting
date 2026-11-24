'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, FolderHeart, Languages, Lock, PhoneCall, Users, Wallet } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { consult, errorMessage, errorStatus, instant } from '@/lib/consult/api';
import { attemptKey, forgetAttemptKey } from '@/lib/consult/idempotency';
import { formatCountdown, mapCreateError, saveBooking } from '@/lib/consult/bookingFlow';
import { formatPaise } from '@/lib/consult/format';
import { recordShareText } from '@/lib/consult/consent';
import { consultPrice, priceLines, walletRupeesToPaise } from '@/lib/consult/price';
import { serverNow } from '@/lib/consult/time';
import {
    EMERGENCY_HINT_AFTER_MS, INSTANT_POLL_MS, REASON_MAX, cleanReason, docsOnline, elapsed, endedCopy, feeRange, instantScreen, queueLine, secondsLeft,
} from '@/lib/consult/instant';
import { allergyState, isSelfPerson, type HealthPerson } from '@/lib/health';
import { HealthDetailsForm } from '@/components/health/HealthDetailsForm';
import { AddFamilyMemberDialog } from '@/components/profile/AddFamilyMemberDialog';
import { DoctorAvatar } from '@/components/consult/DoctorCard';
import { PersonPicker, type Person } from '@/components/consult/PersonPicker';
import { PromoBox } from '@/components/consult/PromoBox';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { Button, Card, Notice } from '@/components/ui';
import { Footer } from '@/components/Footer';
import type { ConsultPromoQuote, InstantAvailability, InstantView } from '@/lib/consult/types';

type BookPerson = Person & HealthPerson;

function sortPeople(list: BookPerson[]): BookPerson[] {
    const isSelf = (p: Person) => p.relation?.toLowerCase() === 'self';
    return [...list].sort((a, b) => (isSelf(a) === isSelf(b) ? a.name.localeCompare(b.name) : isSelf(a) ? -1 : 1));
}

/** Ticks once a second on the server clock, for the timers. */
function useTick(active: boolean) {
    const [now, setNow] = useState(() => serverNow());
    useEffect(() => {
        if (!active) return;
        const t = setInterval(() => setNow(serverNow()), 1000);
        return () => clearInterval(t);
    }, [active]);
    return now;
}

function EmergencyLine() {
    return (
        <Notice tone="warning">
            Chest pain, trouble breathing, fainting or heavy bleeding? Call <b>112</b> or go to the nearest hospital now.
        </Notice>
    );
}

export default function ConsultNowPage() {
    const router = useRouter();
    const { isAuthenticated, isInitialized } = useAuth();
    const { openAuthDialog } = useAuthGate();

    const [request, setRequest] = useState<InstantView | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [availability, setAvailability] = useState<InstantAvailability | null>(null);

    // The form (kept after a request ends, so "Try again" is one tap).
    const [people, setPeople] = useState<BookPerson[] | null>(null);
    const [personId, setPersonId] = useState('');
    const [reason, setReason] = useState('');
    const [shareRecord, setShareRecord] = useState(false);
    const [skippedAllergies, setSkippedAllergies] = useState<string[]>([]);
    const [allergyDraft, setAllergyDraft] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    // Paying, once a Doc accepted.
    const [walletBalancePaise, setWalletBalancePaise] = useState<number | null>(null);
    const [useWallet, setUseWallet] = useState(false);
    const [promo, setPromo] = useState<ConsultPromoQuote | null>(null);

    const screen = request ? instantScreen(request.status) : 'form';
    const now = useTick(screen === 'searching' || screen === 'pay');

    const loadAvailability = useCallback(() => instant.availability().then(setAvailability).catch(() => setAvailability(null)), []);

    useEffect(() => {
        if (!isInitialized || !isAuthenticated) return;
        let alive = true;
        (async () => {
            try {
                try { await api.post('/profile/patients/ensure-self'); } catch { /* a thin profile is fine to skip */ }
                const [active, ppl, wallet] = await Promise.all([
                    instant.active(),
                    api.get('/profile/patients'),
                    api.get('/profile/wallet').catch(() => null),
                    loadAvailability(),
                ]);
                if (!alive) return;
                const list = sortPeople((ppl.data as BookPerson[]) || []);
                setPeople(list);
                setPersonId((cur) => cur || active.request?.patient.id || list[0]?.id || '');
                setWalletBalancePaise(wallet ? walletRupeesToPaise(wallet.data?.balance) : null);
                if (active.request) setRequest(active.request);
            } catch (e) {
                if (alive) setLoadError(errorMessage(e));
            } finally {
                if (alive) setLoaded(true);
            }
        })();
        return () => {
            alive = false;
        };
    }, [isInitialized, isAuthenticated, loadAvailability]);

    // Waiting and paying: ask the server for news every few seconds. It also moves the queue along.
    const requestId = request?.id;
    const live = screen === 'searching' || screen === 'pay';
    useEffect(() => {
        if (!requestId || !live) return;
        let alive = true;
        const t = setInterval(() => {
            instant.poll(requestId).then((v) => alive && setRequest(v)).catch(() => { /* next poll tries again */ });
        }, INSTANT_POLL_MS);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [requestId, live]);

    // Paid elsewhere (another tab, the wallet): straight to the booking.
    useEffect(() => {
        if (request?.status === 'BOOKED' && request.consultationId) router.replace(`/consult/booking/${request.consultationId}`);
    }, [request?.status, request?.consultationId, router]);

    // When the screen is in the background, the tab title says a Doc is ready.
    const accepted = screen === 'pay';
    const titleRef = useRef<string | null>(null);
    useEffect(() => {
        if (!accepted) return;
        titleRef.current = document.title;
        document.title = 'A Doc is ready · pay to start';
        return () => {
            if (titleRef.current) document.title = titleRef.current;
        };
    }, [accepted]);

    // An ended request: refresh "who is online" for the next step.
    useEffect(() => {
        if (screen === 'ended') void loadAvailability();
    }, [screen, loadAvailability]);

    async function start() {
        if (!personId || busy) return;
        if (allergyDraft && !skippedAllergies.includes(personId)) {
            setProblem('Save the allergies you entered, or press Skip for now, first.');
            return;
        }
        const text = cleanReason(reason);
        if (text.length < 3) {
            setProblem('Tell the doctor briefly what is wrong.');
            return;
        }
        setBusy(true);
        setProblem(null);
        try {
            setRequest(await instant.start({ patientId: personId, reason: text, shareRecord }));
            setPromo(null);
            setUseWallet(false);
        } catch (e) {
            if (errorStatus(e) === 401) openAuthDialog();
            else setProblem(errorMessage(e));
            if (errorStatus(e) === 409) void loadAvailability();
        } finally {
            setBusy(false);
        }
    }

    async function stop() {
        if (!request || busy) return;
        setBusy(true);
        setProblem(null);
        try {
            setRequest(await instant.cancel(request.id));
        } catch (e) {
            setProblem(errorMessage(e));
            if (errorStatus(e) === 409 && request.consultationId) router.push(`/consult/booking/${request.consultationId}`);
        } finally {
            setBusy(false);
        }
    }

    async function pay() {
        if (!request?.doctor || !request.slotId || busy) return;
        setBusy(true);
        setProblem(null);
        const shown = consultPrice(request.doctor.feePaise, walletBalancePaise ?? 0, useWallet, promo?.discountPaise);
        const withWallet = shown.walletPaise > 0;
        const variant = ['instant', withWallet ? 'wallet' : '', promo ? `promo-${promo.code}` : ''].filter(Boolean).join('-');
        const patientId = request.patient.id;
        try {
            const res = await consult.createBooking({
                slotId: request.slotId,
                patientId,
                idempotencyKey: attemptKey(request.slotId, patientId, variant),
                instantRequestId: request.id,
                ...(withWallet ? { useWallet: true, expectedWalletPaise: shown.walletPaise } : {}),
                ...(promo ? { promoCode: promo.code, expectedDiscountPaise: shown.discountPaise } : {}),
                shareRecord: request.shareRecord,
            });
            saveBooking({ id: res.consultationId, slotId: request.slotId, patientId });
            router.push(res.status === 'CONFIRMED' ? `/consult/booking/${res.consultationId}` : `/consult/booking/${res.consultationId}?pay=1`);
        } catch (e) {
            const message = errorMessage(e);
            const action = mapCreateError(errorStatus(e), (e as { response?: { data?: { error?: string } } })?.response?.data?.error);
            if (action.forgetKey) forgetAttemptKey(request.slotId, patientId, variant);
            if (action.kind === 'login') openAuthDialog();
            else if (action.kind === 'wallet_changed') setProblem('Your wallet balance just changed. Check the amount and try again.');
            else if (action.kind === 'promo_changed' && promo) {
                setPromo(null);
                setProblem(`The discount for ${promo.code} just changed. Apply it again to see the new amount.`);
            } else if (action.kind === 'busy') setProblem('The payment service is busy. Please try again in a moment.');
            else setProblem(message);
            instant.poll(request.id).then(setRequest).catch(() => {});
            setBusy(false);
        }
    }

    if (!isInitialized) return <LoadingBlock />;
    if (!isAuthenticated) {
        return (
            <main className="mx-auto max-w-md px-4 py-10 text-center">
                <h1 className="text-xl font-bold">Log in to consult a Doc now</h1>
                <p className="mt-2 text-sm text-ink-muted">We need to know who the consultation is for.</p>
                <Button className="mt-4" onClick={openAuthDialog}>Log in</Button>
            </main>
        );
    }
    if (loadError) return <main className="mx-auto max-w-md px-4 py-10"><ErrorState message={loadError} onRetry={() => window.location.reload()} /></main>;
    if (!loaded || !people) return <LoadingBlock label="Getting things ready" />;

    const chosen = people.find((p) => p.id === personId);
    const fees = availability ? feeRange(availability) : null;

    return (
        <>
            <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16">
                <Link href="/consult" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                    <ChevronLeft className="h-4 w-4" aria-hidden /> Consult home
                </Link>

                {screen === 'form' && (
                    <>
                        <h1 className="mt-6 text-2xl font-bold text-ink md:text-3xl">Consult a Doc now</h1>
                        <p className="mt-1 text-ink-muted">
                            {availability && availability.online > 0
                                ? `${docsOnline(availability.online)}. You pay only after a Doc accepts${fees ? ` (fee ${fees})` : ''}.`
                                : 'You pay only after a Doc accepts.'}
                        </p>
                        {availability && availability.online === 0 && (
                            <Notice tone="info" className="mt-4" title="No Doc is online right now">
                                {availability.nextSlot
                                    ? <>Book a time instead: <Link className="font-semibold underline" href={`/consult/doctors/${availability.nextSlot.doctorId}`}>{availability.nextSlot.doctorName}</Link>.</>
                                    : <>Book a time with any doctor from <Link className="font-semibold underline" href="/consult">Consult home</Link>.</>}
                            </Notice>
                        )}

                        <Card className="mt-6 p-6">
                            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-ink">
                                <Users className="h-5 w-5 text-ink-subtle" aria-hidden /> Who is it for?
                            </h2>
                            <PersonPicker people={people} value={personId} onChange={(id) => { if (id !== personId) setShareRecord(false); setPersonId(id); }} onAdd={() => setAddOpen(true)} />
                        </Card>

                        <Card className="mt-6 p-6">
                            <label htmlFor="instant-reason" className="text-lg font-bold text-ink">What&apos;s wrong?</label>
                            <p className="mt-1 text-sm text-ink-muted">The doctor reads this before accepting.</p>
                            <textarea
                                id="instant-reason"
                                value={reason}
                                maxLength={REASON_MAX}
                                rows={3}
                                placeholder="For example: fever since yesterday, body ache"
                                onChange={(e) => setReason(e.target.value)}
                                className="mt-3 w-full rounded-lg border border-border-strong bg-surface p-3 text-base outline-none focus:ring-2 focus:ring-primary"
                            />
                            <p className="mt-1 text-right text-xs text-ink-subtle tabular-nums">{reason.length}/{REASON_MAX}</p>
                        </Card>

                        {chosen && allergyState(chosen) === 'unknown' && !skippedAllergies.includes(chosen.id) && (
                            <Card className="mt-6 p-6" aria-label="Allergies">
                                <h2 className="text-lg font-bold text-ink">{isSelfPerson(chosen) ? 'Do you have any allergies?' : `Does ${chosen.name} have any allergies?`}</h2>
                                <p className="mb-4 mt-1 text-sm text-ink-muted">The doctor checks this before prescribing.</p>
                                <HealthDetailsForm
                                    key={chosen.id}
                                    person={chosen}
                                    mode="allergies"
                                    saveLabel="Save allergies"
                                    onSkip={() => { setAllergyDraft(false); setSkippedAllergies((cur) => [...cur, chosen.id]); }}
                                    onDirtyChange={setAllergyDraft}
                                    onSaved={(saved) => { setAllergyDraft(false); setPeople((cur) => cur && cur.map((p) => (p.id === saved.id ? { ...p, ...saved } : p))); }}
                                />
                            </Card>
                        )}

                        {chosen && (
                            <Card className="mt-6 p-4" aria-label="Share health record">
                                <label className="flex cursor-pointer items-start gap-3">
                                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-primary)]" checked={shareRecord} onChange={(e) => setShareRecord(e.target.checked)} />
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-2 font-semibold text-ink">
                                            <FolderHeart className="h-4 w-4 text-ink-subtle" aria-hidden /> Share {isSelfPerson(chosen) ? 'my' : `${chosen.name}'s`} health record with the doctor
                                        </span>
                                        <span className="mt-0.5 block text-sm text-ink-muted">{recordShareText('the doctor who accepts', isSelfPerson(chosen) ? undefined : chosen.name)}</span>
                                        <span className="mt-1 block text-xs text-ink-subtle">Optional. Without it the doctor sees only what you write here.</span>
                                    </span>
                                </label>
                            </Card>
                        )}

                        {problem && <Notice tone="danger" className="mt-6">{problem}</Notice>}

                        <Button size="lg" className="mt-6 w-full" disabled={!personId || availability?.online === 0} loading={busy} onClick={start}>
                            {busy ? 'Finding a Doc' : 'Find a Doc now'}
                        </Button>
                        <p className="mt-3 text-center text-sm text-ink-muted">Nothing is charged until a Doc accepts.</p>
                    </>
                )}

                {screen === 'searching' && request && (
                    <section aria-labelledby="searching-title" className="mt-8 flex flex-col items-center text-center">
                        <h1 id="searching-title" className="text-2xl font-bold text-ink">Finding a Doc for you</h1>
                        <div className="relative mt-8 flex h-36 w-36 items-center justify-center rounded-full bg-primary-soft" aria-hidden>
                            <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary opacity-20 motion-reduce:animate-none" />
                            <span className="font-mono text-3xl font-bold tabular-nums text-primary">{elapsed(request.createdAt, now)}</span>
                        </div>
                        <p className="sr-only" role="timer">Searching for {elapsed(request.createdAt, now)}</p>
                        <ol className="mt-8 w-full max-w-sm space-y-2 text-left text-sm" aria-label="Steps">
                            <li className="flex items-center gap-2 text-ink-muted"><span className="font-bold text-success" aria-hidden>✓</span> Request sent to available Docs</li>
                            <li aria-current="step" className="flex items-center gap-2 font-semibold text-ink"><span className="text-primary" aria-hidden>●</span> Waiting for a Doc to accept</li>
                            <li className="flex items-center gap-2 text-ink-muted"><span aria-hidden>○</span> Pay and join the call</li>
                        </ol>
                        <p className="mt-6 max-w-sm rounded-xl bg-primary-soft p-3 text-sm text-ink" aria-live="polite">{queueLine(request)}</p>
                        <p className="mt-3 text-sm text-ink-muted">For {request.patient.name} · Keep this page open. We&apos;ll also notify your phone.</p>
                        {now - Date.parse(request.createdAt) >= EMERGENCY_HINT_AFTER_MS && <div className="mt-6 w-full"><EmergencyLine /></div>}
                        {problem && <Notice tone="danger" className="mt-4 w-full">{problem}</Notice>}
                        <Button variant="secondary" className="mt-8" loading={busy} onClick={stop}>Stop looking</Button>
                        <p className="mt-2 text-xs text-ink-subtle">Nothing has been charged.</p>
                    </section>
                )}

                {screen === 'pay' && request?.doctor && request.slotId && (() => {
                    const d = request.doctor;
                    const price = consultPrice(d.feePaise, walletBalancePaise ?? 0, useWallet, promo?.discountPaise);
                    const left = secondsLeft(request.payBy, now, 180);
                    return (
                        <>
                            <Notice tone="success" className="mt-6" title="A Doc accepted">Pay to start the video call straight away.</Notice>
                            <Card className="mt-6 p-5">
                                <div className="flex items-start gap-4">
                                    <DoctorAvatar doctor={d} className="h-16 w-16 text-lg" />
                                    <div className="min-w-0">
                                        <p className="text-lg font-bold text-ink">{d.displayName}</p>
                                        <p className="text-sm text-ink-muted">{d.qualification} · {d.specialty}{d.experienceYears > 0 ? ` · ${d.experienceYears} yrs` : ''}</p>
                                        {d.languages.length > 0 && (
                                            <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted"><Languages className="h-4 w-4" aria-hidden /> {d.languages.join(', ')}</p>
                                        )}
                                    </div>
                                </div>
                            </Card>
                            <Card className="mt-4 p-4">
                                <dl className="space-y-1.5 text-sm">
                                    {(priceLines(price, formatPaise, promo?.code) ?? []).map((l) => (
                                        <div key={l.label} className="flex justify-between gap-3"><dt className="text-ink-muted">{l.label}</dt><dd className="text-ink">{l.value}</dd></div>
                                    ))}
                                    <div className={`flex justify-between gap-3${priceLines(price, formatPaise, promo?.code) ? ' border-t border-border pt-2' : ''}`}>
                                        <dt className="font-semibold">{price.discountPaise > 0 || price.walletPaise > 0 ? 'To pay now' : 'Consultation fee'}</dt>
                                        <dd className="text-lg font-semibold text-ink">{formatPaise(price.payPaise)}</dd>
                                    </div>
                                </dl>
                            </Card>
                            <PromoBox doctorId={d.id} slotId={request.slotId} applied={promo} onChange={setPromo} />
                            {(walletBalancePaise ?? 0) > 0 && (
                                <Card className="mt-6 p-4">
                                    <label className="flex cursor-pointer items-start gap-3">
                                        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-primary)]" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} />
                                        <span className="min-w-0">
                                            <span className="flex items-center gap-2 font-semibold text-ink"><Wallet className="h-4 w-4 text-ink-subtle" aria-hidden /> Use DocNow wallet</span>
                                            <span className="mt-0.5 block text-sm text-ink-muted">Balance {formatPaise(walletBalancePaise ?? 0)}.</span>
                                        </span>
                                    </label>
                                </Card>
                            )}
                            <Notice tone="warning" className="mt-6">
                                <span aria-live="polite">{d.displayName} is waiting. Pay within <b className="font-mono tabular-nums">{formatCountdown(left)}</b>.</span>
                            </Notice>
                            {problem && <Notice tone="danger" className="mt-4">{problem}</Notice>}
                            <Button size="lg" className="mt-6 w-full" loading={busy} disabled={left === 0} onClick={pay}>
                                {price.payPaise > 0 ? `Pay ${formatPaise(price.payPaise)} and join` : 'Confirm and join'}
                            </Button>
                            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-ink-muted">
                                <Lock className="h-4 w-4 text-ink-subtle" aria-hidden /> Secured by Razorpay · Full refund if the doctor does not join
                            </div>
                            <div className="mt-6 text-center">
                                <Button variant="ghost" size="sm" disabled={busy} onClick={stop}>Not now</Button>
                                <p className="text-xs text-ink-subtle">The doctor is freed. Nothing is charged.</p>
                            </div>
                        </>
                    );
                })()}

                {screen === 'booked' && <LoadingBlock label="Opening your consultation" />}

                {screen === 'ended' && request && (() => {
                    const copy = endedCopy(request.status);
                    return (
                        <section aria-labelledby="ended-title" className="mt-8">
                            <h1 id="ended-title" className="text-2xl font-bold text-ink">{copy.title}</h1>
                            <p className="mt-2 text-ink-muted">{copy.body}</p>
                            {availability?.nextSlot && (
                                <Card className="mt-6 p-5">
                                    <p className="text-sm font-semibold text-ink-muted">Earliest Doc time</p>
                                    <p className="mt-1 font-semibold text-ink">{availability.nextSlot.doctorName} · {formatPaise(availability.nextSlot.feePaise)}</p>
                                    <Link href={`/consult/doctors/${availability.nextSlot.doctorId}`} className="mt-3 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover">
                                        See times
                                    </Link>
                                </Card>
                            )}
                            <div className="mt-6 flex flex-wrap gap-3">
                                <Button onClick={() => { setRequest(null); setProblem(null); }} disabled={availability?.online === 0}>
                                    <PhoneCall className="h-4 w-4" aria-hidden /> Try again
                                </Button>
                                <Link href="/consult" className="inline-flex h-11 items-center rounded-lg border border-border px-5 text-sm font-semibold text-primary hover:bg-primary-soft">
                                    Book a time instead
                                </Link>
                            </div>
                            {availability?.online === 0 && <p className="mt-2 text-sm text-ink-muted">No Doc is online right now, so Try again is off.</p>}
                            {request.status === 'NO_MATCH' && <div className="mt-6"><EmergencyLine /></div>}
                        </section>
                    );
                })()}

                <AddFamilyMemberDialog
                    open={addOpen}
                    onOpenChange={setAddOpen}
                    onMemberAdded={(p) => {
                        setPeople((cur) => sortPeople([...(cur ?? []), p as BookPerson]));
                        setShareRecord(false);
                        setPersonId(p.id);
                    }}
                />
            </main>
            <Footer />
        </>
    );
}
