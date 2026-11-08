'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Lock, ChevronLeft, Users } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { consult, errorMessage, errorStatus } from '@/lib/consult/api';
import { attemptKey, forgetAttemptKey } from '@/lib/consult/idempotency';
import { loadSavedBooking, mapCreateError, saveBooking } from '@/lib/consult/bookingFlow';
import { formatRupees } from '@/lib/consult/format';
import { serverNow } from '@/lib/consult/time';
import { AddFamilyMemberDialog } from '@/components/profile/AddFamilyMemberDialog';
import { BookingSummary } from '@/components/consult/BookingSummary';
import { PersonPicker, type Person } from '@/components/consult/PersonPicker';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { Button, Card, Notice } from '@/components/ui';
import { Footer } from '@/components/Footer';
import type { DoctorPublicProfile, Slot } from '@/lib/consult/types';

function sortPeople(list: Person[]): Person[] {
    const isSelf = (p: Person) => p.relation?.toLowerCase() === 'self';
    return [...list].sort((a, b) => (isSelf(a) === isSelf(b) ? a.name.localeCompare(b.name) : isSelf(a) ? -1 : 1));
}

function BookPage() {
    const router = useRouter();
    const params = useSearchParams();
    const doctorId = params.get('doctorId');
    const slotId = params.get('slotId');
    const { isAuthenticated, isInitialized } = useAuth();
    const { openAuthDialog } = useAuthGate();

    const [doctor, setDoctor] = useState<DoctorPublicProfile | null>(null);
    const [slot, setSlot] = useState<Slot | null>(null);
    const [people, setPeople] = useState<Person[] | null>(null);
    const [personId, setPersonId] = useState('');
    const [loadError, setLoadError] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<{ message: string; myLink?: boolean } | null>(null);

    const backToDoctor = useCallback(
        (notice: string) => router.replace(doctorId ? `/consult/doctors/${doctorId}?notice=${notice}` : '/consult'),
        [router, doctorId]
    );

    useEffect(() => {
        if (!isInitialized || !isAuthenticated) return;
        if (!doctorId || !slotId) {
            router.replace('/consult');
            return;
        }
        // The same slot already has a saved booking, so go back to it instead of starting again.
        const saved = loadSavedBooking();
        if (saved && saved.slotId === slotId) {
            router.replace(`/consult/booking/${saved.id}`);
            return;
        }
        let alive = true;
        (async () => {
            try {
                // Same way the camps page makes the "Self" person; a thin profile is fine to skip.
                try { await api.post('/profile/patients/ensure-self'); } catch { /* profile may be incomplete */ }
                const [d, slots, ppl] = await Promise.all([consult.doctor(doctorId), consult.slots(doctorId), api.get('/profile/patients')]);
                if (!alive) return;
                const found = slots.find((s) => s.id === slotId);
                if (!found || Date.parse(found.startsAt) <= serverNow()) {
                    backToDoctor('slot_gone');
                    return;
                }
                const list = sortPeople((ppl.data as Person[]) || []);
                setDoctor(d);
                setSlot(found);
                setPeople(list);
                setPersonId((cur) => cur || list[0]?.id || '');
            } catch (e) {
                if (!alive) return;
                if (errorStatus(e) === 404) backToDoctor('slot_gone');
                else setLoadError(errorMessage(e));
            }
        })();
        return () => {
            alive = false;
        };
    }, [isInitialized, isAuthenticated, doctorId, slotId, router, backToDoctor]);

    async function pay() {
        if (!slot || !personId || busy) return;
        setBusy(true);
        setProblem(null);
        try {
            const res = await consult.createBooking({ slotId: slot.id, patientId: personId, idempotencyKey: attemptKey(slot.id, personId) });
            saveBooking({ id: res.consultationId, slotId: slot.id, patientId: personId });
            router.push(`/consult/booking/${res.consultationId}?pay=1`);
        } catch (e) {
            const action = mapCreateError(errorStatus(e), (e as { response?: { data?: { error?: string } } })?.response?.data?.error);
            if (action.forgetKey) forgetAttemptKey(slot.id, personId);
            const message = errorMessage(e);
            if (action.kind === 'slot_taken') backToDoctor('slot_taken');
            else if (action.kind === 'login') openAuthDialog();
            else if (action.kind === 'too_many') setProblem({ message, myLink: true });
            else if (action.kind === 'busy') setProblem({ message: 'The payment service is busy. Please try again in a moment.' });
            else if (action.kind === 'ended') setProblem({ message: 'That booking ended. Press Pay to start a fresh one.' });
            else setProblem({ message });
            setBusy(false);
        }
    }

    if (!isInitialized) return <LoadingBlock />;
    if (!isAuthenticated) {
        return (
            <main className="mx-auto max-w-md px-4 py-10 text-center">
                <h1 className="text-xl font-semibold">Log in to book</h1>
                <p className="mt-2 text-sm text-ink-muted">Please log in to finish your booking. Your chosen time is kept.</p>
                <Button className="mt-4" onClick={openAuthDialog}>Log in</Button>
            </main>
        );
    }
    if (loadError) return <main className="mx-auto max-w-md px-4 py-10"><ErrorState message={loadError} onRetry={() => router.refresh()} /></main>;
    if (!doctor || !slot || !people) {
        return (
            <>
                <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16 animate-pulse">
                    <div className="mb-6 h-4 w-24 bg-surface-muted rounded" />

                    {/* Progress Stepper Skeleton */}
                    <div className="mt-6 flex items-center justify-center gap-2">
                        <div className="h-5 w-5 bg-surface-muted rounded-full" />
                        <div className="h-4 w-24 bg-surface-muted rounded" />
                        <div className="h-px w-8 bg-surface-muted" />
                        <div className="h-5 w-5 bg-surface-muted rounded-full" />
                        <div className="h-4 w-24 bg-surface-muted rounded" />
                        <div className="h-px w-8 bg-surface-muted" />
                        <div className="h-5 w-5 bg-surface-muted rounded-full" />
                        <div className="h-4 w-28 bg-surface-muted rounded" />
                    </div>

                    <div className="mt-8 h-10 w-48 bg-surface-muted rounded mx-auto" />

                    {/* Booking Summary Skeleton */}
                    <Card className="mt-8 p-6">
                        <div className="space-y-4">
                            <div className="h-6 w-3/4 bg-surface-muted rounded" />
                            <div className="h-4 w-1/2 bg-surface-muted rounded" />
                            <div className="h-4 w-2/3 bg-surface-muted rounded" />
                            <div className="flex justify-between border-t pt-4">
                                <div className="h-5 w-20 bg-surface-muted rounded" />
                                <div className="h-5 w-24 bg-surface-muted rounded" />
                            </div>
                        </div>
                    </Card>

                    {/* Patient Picker Skeleton */}
                    <Card className="mt-6 p-6">
                        <div className="mb-4 flex items-center gap-3">
                            <div className="h-10 w-10 bg-surface-muted rounded-full" />
                            <div className="h-6 w-64 bg-surface-muted rounded" />
                        </div>
                        <div className="space-y-2">
                            <div className="h-12 w-full bg-surface-muted rounded-xl" />
                            <div className="h-12 w-full bg-surface-muted rounded-xl" />
                        </div>
                    </Card>

                    {/* Pay Button Skeleton */}
                    <div className="mt-8 h-14 w-full bg-surface-muted rounded-xl" />
                    <div className="mt-4 flex justify-center gap-2">
                        <div className="h-4 w-4 bg-surface-muted rounded" />
                        <div className="h-4 w-64 bg-surface-muted rounded" />
                    </div>
                </main>
                <Footer />
            </>
        );
    }

    return (
        <>
            <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16">
                <Link href={`/consult/doctors/${doctor.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    Change time
                </Link>

                {/* Where they are in three steps; the current one is read out as such. */}
                <ol className="mt-6 flex items-center gap-2 text-sm" aria-label="Booking steps">
                    <li className="flex items-center gap-1.5 text-ink-muted"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />Doctor</li>
                    <li aria-hidden className="h-px w-6 bg-border" />
                    <li className="flex items-center gap-1.5 text-ink-muted"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />Time</li>
                    <li aria-hidden className="h-px w-6 bg-border" />
                    <li aria-current="step" className="flex items-center gap-1.5 font-medium text-ink">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-on-primary" aria-hidden>3</span>Review and pay
                    </li>
                </ol>

                <h1 className="mt-6 text-2xl font-semibold text-ink md:text-3xl">Review and pay</h1>

                {/* Booking Summary Card */}
                <Card className="mt-6">
                    <BookingSummary
                        doctorName={doctor.displayName}
                        specialty={doctor.specialty.name}
                        startsAt={slot.startsAt}
                        endsAt={slot.endsAt}
                        amount={formatRupees(doctor.consultationFee)}
                    />
                </Card>

                {/* Patient Picker Card */}
                <Card className="mt-6 p-6">
                    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-ink">
                        <Users className="h-5 w-5 text-ink-subtle" aria-hidden /> Who is this consultation for?
                    </h2>
                    <PersonPicker people={people} value={personId} onChange={setPersonId} onAdd={() => setAddOpen(true)} />
                </Card>

                {/* Error Message */}
                {problem && (
                    <Notice tone="danger" className="mt-6">
                        {problem.message}
                        {problem.myLink && <> <Link href="/consult/my" className="font-medium underline">Go to My consultations</Link></>}
                    </Notice>
                )}

                {/* Pay Button */}
                <Button size="lg" className="mt-6 w-full" disabled={!personId} loading={busy} onClick={pay}>
                    {busy ? 'Getting your payment ready' : `Pay ${formatRupees(doctor.consultationFee)}`}
                </Button>

                {/* Trust Line */}
                <div className="mt-3 flex items-center justify-center gap-2 text-sm text-ink-muted">
                    <Lock className="h-4 w-4 text-ink-subtle" aria-hidden />
                    <span>Secured by Razorpay · Your time is held while you pay</span>
                </div>

                <AddFamilyMemberDialog
                    open={addOpen}
                    onOpenChange={setAddOpen}
                    onMemberAdded={(p) => {
                        setPeople((cur) => sortPeople([...(cur ?? []), p]));
                        setPersonId(p.id);
                    }}
                />
            </main>
            <Footer />
        </>
    );
}

export default function BookPageWrapper() {
    return (
        <Suspense fallback={<LoadingBlock />}>
            <BookPage />
        </Suspense>
    );
}
