'use client';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { BadgeCheck, Calendar, ChevronLeft, Clock, FileText, FlaskConical, Languages, Briefcase, IndianRupee, Users, Video } from 'lucide-react';
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
            <main className="w-full bg-surface pb-32 md:pb-16">
                {/* The consult band: the doctor's identity on the brand purple, as on the consult home. */}
                <section className="bg-primary-hover text-on-primary">
                    <div className="container mx-auto max-w-6xl px-4 pb-20 pt-6 lg:pb-24">
                        <Link href="/consult" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-soft hover:text-on-primary hover:underline">
                            <ChevronLeft className="h-4 w-4" aria-hidden />
                            All doctors
                        </Link>
                        <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-center">
                            <DoctorAvatar doctor={d} className="h-20 w-20 text-xl ring-4 ring-on-primary/15 md:h-24 md:w-24 md:text-2xl" />
                            <div className="min-w-0 space-y-1">
                                <h1 className="flex flex-wrap items-center gap-2 text-3xl font-semibold tracking-tight md:text-4xl">
                                    {d.displayName}
                                    <BadgeCheck className="h-6 w-6" aria-label="Verified" />
                                </h1>
                                <p className="text-lg text-primary-soft">{d.specialty.name} · {d.qualification}</p>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="container mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[1fr_400px] lg:items-start">
                    <div className="-mt-12 space-y-6">
                        {notice && <Notice tone="warning">{notice}</Notice>}

                        <Card className="p-6 md:p-8">
                            <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
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
                                    <h2 className="mb-2 text-lg font-semibold text-ink">About</h2>
                                    <p className="max-w-prose text-base leading-relaxed text-ink">{d.bio}</p>
                                </div>
                            )}

                            <div className="mt-6 border-t border-border pt-6">
                                <h2 className="mb-3 text-lg font-semibold text-ink">What you get</h2>
                                <ul className="grid gap-3 sm:grid-cols-2">
                                    {[
                                        { icon: Video, text: `A ${d.slotMinutes}-minute video call (switch to audio any time)` },
                                        { icon: FileText, text: 'A digital prescription on your phone' },
                                        { icon: FlaskConical, text: 'Recommended tests added to your cart in one tap' },
                                        { icon: Users, text: 'Book for yourself or a family member' },
                                    ].map(({ icon: Icon, text }) => (
                                        <li key={text} className="flex items-start gap-3 text-sm text-ink">
                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Icon className="h-4 w-4" aria-hidden /></span>
                                            <span className="pt-1.5">{text}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <p className="mt-6 border-t border-border pt-4 text-sm text-ink-muted">
                                Registration: {d.registrationNumber} ({d.registrationCouncil})
                            </p>
                        </Card>
                    </div>

                    {/* Booking panel: stays in view on desktop while the profile scrolls. */}
                    <section aria-label="Available times" className="lg:sticky lg:top-24 lg:-mt-12">
                        <Card className="p-5 shadow-raised md:p-6">
                            <h2 className="flex items-center gap-2 text-xl font-semibold text-ink">
                                <Calendar className="h-5 w-5 text-primary" aria-hidden /> Pick a time
                            </h2>
                            <p className="mb-4 mt-1 text-sm text-ink-muted">All times are Indian time.</p>
                            {slotsApi.loading && (
                                <div className="grid grid-cols-3 gap-2">
                                    {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-11" />)}
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

                            <div className="mt-5 hidden border-t border-border pt-5 lg:block">
                                <div className="mb-4 flex items-baseline justify-between gap-3">
                                    <span className="text-sm text-ink-muted">{selected ? formatIstDateTime(selected.startsAt) : 'Choose a time above'}</span>
                                    <span className="text-lg font-semibold tabular-nums text-ink">{formatRupees(d.consultationFee)}</span>
                                </div>
                                <Button size="lg" className="w-full" disabled={!selected} onClick={goBook}>Continue to payment</Button>
                            </div>
                        </Card>
                    </section>
                </div>
            </main>

            {/* Mobile Sticky Bottom Bar */}
            {selected && (
                <StickyBottomBar className="safe-area-bottom z-40 border-t border-border bg-surface px-4 py-3 shadow-raised lg:hidden">
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
