'use client';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { consult } from '@/lib/consult/api';
import { formatRupees } from '@/lib/consult/format';
import { formatIstDateTime, serverNow } from '@/lib/consult/time';
import { DoctorAvatar } from '@/components/consult/DoctorCard';
import { SlotPicker } from '@/components/consult/SlotPicker';
import { EmptyState, ErrorState, Skeleton } from '@/components/consult/States';
import { Button } from '@/components/ui';
import type { Slot } from '@/lib/consult/types';

const NOTICES: Record<string, string> = {
    slot_gone: 'That time is no longer available. Please pick another.',
    slot_taken: 'Someone else just booked that time. Please pick another.',
};

function DoctorPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const notice = NOTICES[useSearchParams().get('notice') ?? ''];
    const { requireAuth } = useAuthGate();
    const doctor = useApi(() => consult.doctor(id), [id]);
    const slotsApi = useApi(() => consult.slots(id), [id]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const setSlots = slotsApi.setData;

    // Quiet refresh so a slot taken by someone else disappears without a reload.
    useEffect(() => {
        const t = setInterval(() => {
            consult.slots(id).then(setSlots).catch(() => {});
        }, 60_000);
        return () => clearInterval(t);
    }, [id, setSlots]);

    const slots = useMemo(() => (slotsApi.data ?? []).filter((s) => Date.parse(s.startsAt) > serverNow()), [slotsApi.data]);
    const selected: Slot | undefined = slots.find((s) => s.id === selectedId);

    const dropped = Boolean(selectedId && !selected && !slotsApi.loading && slotsApi.data);

    if (doctor.loading) return <main className="mx-auto max-w-3xl space-y-3 px-4 py-6"><Skeleton className="h-32" /><Skeleton className="h-48" /></main>;
    if (!doctor.data) {
        const notFound = doctor.error?.toLowerCase().includes('not found') || !doctor.error;
        return (
            <main className="mx-auto max-w-3xl px-4 py-6">
                {notFound ? (
                    <EmptyState title="Doctor not found" body="This doctor is not available." action={<Link href="/consult" className="text-sm font-bold text-primary">See all doctors</Link>} />
                ) : (
                    <ErrorState message={doctor.error ?? 'Something went wrong.'} onRetry={doctor.refetch} />
                )}
            </main>
        );
    }

    const d = doctor.data;
    const goBook = () => {
        if (!selected) return;
        requireAuth(() => router.push(`/consult/book?doctorId=${d.id}&slotId=${selected.id}`));
    };

    return (
        <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-32 md:pb-6">
            <Link href="/consult" className="text-sm font-semibold text-primary">&larr; All doctors</Link>

            {notice && <p role="status" className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{notice}</p>}

            <section className="mt-4 rounded-2xl border border-border bg-white p-4 shadow-sm">
                <div className="flex gap-4">
                    <DoctorAvatar doctor={d} className="h-20 w-20 text-xl" />
                    <div className="min-w-0">
                        <h1 className="text-xl font-bold text-foreground">{d.displayName}</h1>
                        <p className="text-sm font-semibold text-primary">{d.specialty.name}</p>
                        <p className="text-sm text-muted-foreground">{d.qualification}</p>
                    </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Experience</dt><dd className="font-semibold">{d.experienceYears} {d.experienceYears === 1 ? 'year' : 'years'}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Fee</dt><dd className="font-semibold">{formatRupees(d.consultationFee)}</dd></div>
                    {d.languages.length > 0 && <div><dt className="text-xs text-muted-foreground">Languages</dt><dd className="font-semibold">{d.languages.join(', ')}</dd></div>}
                    <div><dt className="text-xs text-muted-foreground">Visit length</dt><dd className="font-semibold">{d.slotMinutes} minutes</dd></div>
                </dl>
                {d.bio && <p className="mt-4 text-sm text-foreground">{d.bio}</p>}
                <p className="mt-3 text-xs text-muted-foreground">Registration: {d.registrationNumber} ({d.registrationCouncil})</p>
            </section>

            <section aria-label="Available times" className="mt-6">
                <h2 className="text-lg font-bold text-foreground">Pick a time</h2>
                <div className="mt-3">
                    {slotsApi.loading && <Skeleton className="h-32" />}
                    {!slotsApi.loading && slotsApi.error && <ErrorState message={slotsApi.error} onRetry={slotsApi.refetch} />}
                    {!slotsApi.loading && !slotsApi.error && slots.length === 0 && (
                        <EmptyState title="No free times in the next 14 days" body="This doctor has nothing open right now." action={<Link href="/consult" className="text-sm font-bold text-primary">See other doctors</Link>} />
                    )}
                    {!slotsApi.error && slots.length > 0 && <SlotPicker slots={slots} selectedId={selectedId} onSelect={(s) => { setSelectedId(s.id); }} />}
                    <p role="status" className="mt-2 text-sm font-semibold text-amber-800">
                        {dropped ? 'The time you chose was just taken. Please pick another.' : ''}
                    </p>
                </div>
            </section>

            {selected && (
                <div className="mt-6 hidden items-center justify-between gap-4 rounded-2xl border border-border bg-white p-4 md:flex">
                    <div>
                        <p className="text-xs text-muted-foreground">Your time</p>
                        <p className="font-bold">{formatIstDateTime(selected.startsAt)}</p>
                    </div>
                    <Button size="lg" onClick={goBook}>Continue</Button>
                </div>
            )}
            {selected && (
                <div className="safe-area-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] md:hidden">
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Your time</p>
                            <p className="truncate text-sm font-bold text-gray-900">{formatIstDateTime(selected.startsAt)}</p>
                        </div>
                        <Button onClick={goBook} className="shrink-0 px-6 py-3.5">Continue</Button>
                    </div>
                </div>
            )}
        </main>
    );
}

export default function DoctorPageWrapper() {
    return (
        <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-6"><Skeleton className="h-32" /></main>}>
            <DoctorPage />
        </Suspense>
    );
}
