'use client';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { BadgeCheck, Calendar, ChevronLeft, Clock, Languages, Briefcase, IndianRupee } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { consult } from '@/lib/consult/api';
import { formatRupees } from '@/lib/consult/format';
import { formatIstDateTime, serverNow } from '@/lib/consult/time';
import { DoctorAvatar } from '@/components/consult/DoctorCard';
import { SlotPicker } from '@/components/consult/SlotPicker';
import { EmptyState, ErrorState, Skeleton } from '@/components/consult/States';
import { Button, Card, Notice } from '@/components/ui';
import { Footer } from '@/components/Footer';
import type { Slot } from '@/lib/consult/types';
import { StickyBottomBar } from '@/components/layout/StickyBottomBar';

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

    if (doctor.loading) {
        return (
            <>
                <main className="mx-auto w-full max-w-4xl px-4 py-6 pb-32 md:pb-16" aria-busy>
                    <Skeleton className="h-4 w-24" />
                    <Card className="mt-6 flex gap-5 p-6">
                        <Skeleton className="h-20 w-20 shrink-0 rounded-xl" />
                        <div className="flex-1 space-y-3">
                            <Skeleton className="h-7 w-48" />
                            <Skeleton className="h-4 w-64" />
                            <Skeleton className="h-4 w-40" />
                        </div>
                    </Card>
                    <Skeleton className="mt-8 h-6 w-32" />
                    <Card className="mt-4 p-6"><Skeleton className="h-32 w-full" /></Card>
                </main>
                <Footer />
            </>
        );
    }
    if (!doctor.data) {
        const notFound = doctor.error?.toLowerCase().includes('not found') || !doctor.error;
        return (
            <main className="mx-auto max-w-3xl px-4 py-6">
                {notFound ? (
                    <EmptyState title="Doctor not found" body="This doctor is not available." action={<Link href="/consult" className="text-sm font-medium text-primary hover:underline">See all doctors</Link>} />
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
        <>
            <main className="mx-auto w-full max-w-4xl px-4 py-6 pb-32 md:pb-16">
                <Link href="/consult" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    All doctors
                </Link>

                {notice && <Notice tone="warning" className="mt-4">{notice}</Notice>}

                {/* Doctor profile: light card, facts as a plain list (DESIGN.md "calm clinical"). */}
                <Card className="mt-6 p-6 md:p-8">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                        <DoctorAvatar doctor={d} className="h-20 w-20 text-xl md:h-24 md:w-24 md:text-2xl" />
                        <div className="min-w-0 flex-1 space-y-1">
                            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold text-ink md:text-3xl">
                                {d.displayName}
                                <BadgeCheck className="h-5 w-5 text-primary" aria-label="Verified" />
                            </h1>
                            <p className="text-base text-ink-muted">{d.specialty.name} · {d.qualification}</p>
                        </div>
                    </div>

                    <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-6 sm:grid-cols-4">
                        {[
                            { icon: Briefcase, label: 'Experience', value: `${d.experienceYears} ${d.experienceYears === 1 ? 'year' : 'years'}` },
                            { icon: IndianRupee, label: 'Fee', value: formatRupees(d.consultationFee) },
                            ...(d.languages.length > 0 ? [{ icon: Languages, label: 'Languages', value: d.languages.join(', ') }] : []),
                            { icon: Clock, label: 'Visit length', value: `${d.slotMinutes} min` },
                        ].map(({ icon: Icon, label, value }) => (
                            <div key={label} className="space-y-1">
                                <dt className="flex items-center gap-1.5 text-sm text-ink-muted"><Icon className="h-4 w-4 text-ink-subtle" aria-hidden />{label}</dt>
                                <dd className="font-medium text-ink">{value}</dd>
                            </div>
                        ))}
                    </dl>

                    {d.bio && (
                        <div className="mt-6 border-t border-border pt-6">
                            <h2 className="mb-2 text-base font-semibold text-ink">About</h2>
                            <p className="max-w-prose text-base leading-relaxed text-ink">{d.bio}</p>
                        </div>
                    )}

                    <p className="mt-6 border-t border-border pt-4 text-sm text-ink-muted">
                        Registration: {d.registrationNumber} ({d.registrationCouncil})
                    </p>
                </Card>

                {/* Slot Picker Section */}
                <section aria-label="Available times" className="mt-8">
                    <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold text-ink">
                        <Calendar className="h-5 w-5 text-ink-subtle" aria-hidden /> Pick a time
                    </h2>
                    <p className="mb-4 text-sm text-ink-muted">All times are Indian time.</p>

                    <Card className="p-6 md:p-8">
                        {slotsApi.loading && (
                            <div className="grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-3">
                                {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-11" />)}
                            </div>
                        )}
                        {!slotsApi.loading && slotsApi.error && <ErrorState message={slotsApi.error} onRetry={slotsApi.refetch} />}
                        {!slotsApi.loading && !slotsApi.error && slots.length === 0 && (
                            <EmptyState
                                title="No free times in the next 14 days"
                                body="This doctor has nothing open right now."
                                action={<Link href="/consult" className="text-sm font-medium text-primary hover:underline">See other doctors</Link>}
                            />
                        )}
                        {!slotsApi.error && slots.length > 0 && <SlotPicker slots={slots} selectedId={selectedId} onSelect={(s) => { setSelectedId(s.id); }} />}
                        {dropped && <Notice tone="warning" className="mt-4">The time you chose was just taken. Please pick another.</Notice>}
                    </Card>
                </section>

                {/* Desktop Bottom Bar */}
                {selected && (
                    <Card className="mt-6 hidden items-center justify-between gap-4 p-5 md:flex">
                        <div>
                            <p className="text-sm text-ink-muted">Your time</p>
                            <p className="text-lg font-semibold text-ink">{formatIstDateTime(selected.startsAt)}</p>
                        </div>
                        <Button size="lg" onClick={goBook}>Continue to payment</Button>
                    </Card>
                )}
            </main>

            {/* Mobile Sticky Bottom Bar */}
            {selected && (
                <StickyBottomBar className="safe-area-bottom z-40 border-t border-border bg-surface px-4 py-3 shadow-raised md:hidden">
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-sm text-ink-muted">Your time</p>
                            <p className="truncate text-sm font-medium text-ink">{formatIstDateTime(selected.startsAt)}</p>
                        </div>
                        <Button onClick={goBook} className="shrink-0">Continue</Button>
                    </div>
                </StickyBottomBar>
            )}

            <Footer />
        </>
    );
}

export default function DoctorPageWrapper() {
    return (
        <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-6"><Skeleton className="h-32" /></main>}>
            <DoctorPage />
        </Suspense>
    );
}
