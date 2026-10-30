'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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
import { Button } from '@/components/ui';
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
                <h1 className="text-xl font-bold">Log in to book</h1>
                <p className="mt-2 text-sm text-muted-foreground">Please log in to finish your booking. Your chosen time is kept.</p>
                <Button className="mt-4" onClick={openAuthDialog}>Log in</Button>
            </main>
        );
    }
    if (loadError) return <main className="mx-auto max-w-md px-4 py-10"><ErrorState message={loadError} onRetry={() => router.refresh()} /></main>;
    if (!doctor || !slot || !people) return <LoadingBlock label="Getting your booking ready" />;

    return (
        <main className="mx-auto w-full max-w-lg px-4 py-6">
            <Link href={`/consult/doctors/${doctor.id}`} className="text-sm font-semibold text-primary">&larr; Change time</Link>
            <h1 className="mt-3 text-2xl font-bold text-foreground">Review and pay</h1>

            <div className="mt-4">
                <BookingSummary
                    doctorName={doctor.displayName}
                    specialty={doctor.specialty.name}
                    startsAt={slot.startsAt}
                    endsAt={slot.endsAt}
                    amount={formatRupees(doctor.consultationFee)}
                />
            </div>

            <div className="mt-5 rounded-2xl border border-border bg-white p-4 shadow-sm">
                <PersonPicker people={people} value={personId} onChange={setPersonId} onAdd={() => setAddOpen(true)} />
            </div>

            {problem && (
                <div role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-destructive">
                    {problem.message}
                    {problem.myLink && <> <Link href="/consult/my" className="underline">Go to My consultations</Link></>}
                </div>
            )}

            <Button size="lg" className="mt-5 w-full" disabled={!personId || busy} onClick={pay}>
                {busy ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden /> Getting your payment ready</> : `Pay ${formatRupees(doctor.consultationFee)}`}
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">Your time is held for a few minutes while you pay.</p>

            <AddFamilyMemberDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                onMemberAdded={(p) => {
                    setPeople((cur) => sortPeople([...(cur ?? []), p]));
                    setPersonId(p.id);
                }}
            />
        </main>
    );
}

export default function BookPageWrapper() {
    return (
        <Suspense fallback={<LoadingBlock />}>
            <BookPage />
        </Suspense>
    );
}
