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
import { Button, Card } from '@/components/ui';
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
                <main className="mx-auto w-full max-w-4xl px-4 py-6 pb-32 md:pb-16 animate-pulse">
                    <div className="mb-6 flex items-center gap-2">
                        <div className="h-4 w-4 bg-gray-200 rounded" />
                        <div className="h-4 w-24 bg-gray-200 rounded" />
                    </div>

                    {/* Doctor Hero Card Skeleton */}
                    <Card className="overflow-hidden border-0 shadow-xl">
                        <div
                            className="px-6 pb-24 pt-8 md:px-8 md:pb-28"
                            style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
                        >
                            <div className="flex flex-col items-center gap-4 md:flex-row md:items-start md:gap-6">
                                <div className="h-24 w-24 shrink-0 rounded-2xl bg-white/20 md:h-28 md:w-28" />
                                <div className="flex-1 space-y-3 text-center md:text-left">
                                    <div className="mx-auto h-8 w-48 bg-white/20 rounded md:mx-0" />
                                    <div className="mx-auto h-6 w-32 bg-white/20 rounded-full md:mx-0" />
                                    <div className="mx-auto h-5 w-64 bg-white/15 rounded md:mx-0" />
                                </div>
                            </div>
                        </div>

                        {/* Stats Pills Skeleton */}
                        <div className="-mt-16 px-6 md:px-8">
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                                        <div className="mb-2 h-8 w-8 bg-gray-200 rounded-full" />
                                        <div className="h-3 w-20 bg-gray-200 rounded mb-1" />
                                        <div className="h-4 w-16 bg-gray-200 rounded" />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Bio Skeleton */}
                        <div className="border-t border-border px-6 py-6 md:px-8">
                            <div className="mb-2 h-4 w-16 bg-gray-200 rounded" />
                            <div className="space-y-2">
                                <div className="h-4 w-full bg-gray-200 rounded" />
                                <div className="h-4 w-5/6 bg-gray-200 rounded" />
                            </div>
                        </div>

                        {/* Registration Skeleton */}
                        <div className="border-t border-border bg-gray-50 px-6 py-4 md:px-8">
                            <div className="h-3 w-64 bg-gray-200 rounded" />
                        </div>
                    </Card>

                    {/* Slot Picker Section Skeleton */}
                    <section className="mt-8">
                        <div className="mb-6">
                            <div className="mb-4 h-6 w-40 bg-gray-200 rounded-full" />
                            <div className="h-10 w-48 bg-gray-200 rounded" />
                        </div>
                        <Card className="p-6 shadow-sm md:p-8">
                            <div className="h-32 w-full bg-gray-200 rounded" />
                        </Card>
                    </section>
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
        <>
            <main className="mx-auto w-full max-w-4xl px-4 py-6 pb-32 md:pb-16">
                <Link href="/consult" className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80">
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    All doctors
                </Link>

                {notice && (
                    <div role="status" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 shadow-sm">
                        <p className="text-sm font-semibold text-amber-800">{notice}</p>
                    </div>
                )}

                {/* Doctor Hero Card */}
                <Card className="mt-6 overflow-hidden border-0 shadow-xl">
                    <div
                        className="px-6 pb-24 pt-8 md:px-8 md:pb-28"
                        style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
                    >
                        <div className="flex flex-col items-center gap-4 text-center md:flex-row md:items-start md:gap-6 md:text-left">
                            <DoctorAvatar doctor={d} className="h-24 w-24 text-2xl ring-4 ring-white/20 md:h-28 md:w-28" />
                            <div className="flex-1">
                                <div className="mb-2 flex flex-wrap items-center justify-center gap-2 md:justify-start">
                                    <h1 className="text-2xl font-black text-white md:text-3xl">{d.displayName}</h1>
                                    <BadgeCheck className="h-6 w-6 text-emerald-400" aria-label="Verified" />
                                </div>
                                <div className="mb-3 inline-block rounded-full bg-white/20 px-3 py-1 text-sm font-bold text-white backdrop-blur-sm">
                                    {d.specialty.name}
                                </div>
                                <p className="text-base font-medium text-white/90 md:text-lg">{d.qualification}</p>
                            </div>
                        </div>
                    </div>

                    {/* Stats Pills */}
                    <div className="-mt-16 px-6 md:px-8">
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
                                    <Briefcase className="h-4 w-4 text-primary" aria-hidden />
                                </div>
                                <p className="text-xs font-medium text-muted-foreground">Experience</p>
                                <p className="text-sm font-black text-foreground">{d.experienceYears} {d.experienceYears === 1 ? 'year' : 'years'}</p>
                            </div>
                            <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                                    <IndianRupee className="h-4 w-4 text-emerald-600" aria-hidden />
                                </div>
                                <p className="text-xs font-medium text-muted-foreground">Fee</p>
                                <p className="text-sm font-black text-foreground">{formatRupees(d.consultationFee)}</p>
                            </div>
                            {d.languages.length > 0 && (
                                <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                                        <Languages className="h-4 w-4 text-blue-600" aria-hidden />
                                    </div>
                                    <p className="text-xs font-medium text-muted-foreground">Languages</p>
                                    <p className="text-sm font-black text-foreground">{d.languages.join(', ')}</p>
                                </div>
                            )}
                            <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
                                    <Clock className="h-4 w-4 text-amber-600" aria-hidden />
                                </div>
                                <p className="text-xs font-medium text-muted-foreground">Visit Length</p>
                                <p className="text-sm font-black text-foreground">{d.slotMinutes} min</p>
                            </div>
                        </div>
                    </div>

                    {/* Bio */}
                    {d.bio && (
                        <div className="border-t border-border px-6 py-6 md:px-8">
                            <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-muted-foreground">About</h2>
                            <p className="text-sm leading-relaxed text-foreground md:text-base">{d.bio}</p>
                        </div>
                    )}

                    {/* Registration */}
                    <div className="border-t border-border bg-gray-50 px-6 py-4 md:px-8">
                        <p className="text-xs text-muted-foreground">
                            <span className="font-semibold">Registration:</span> {d.registrationNumber} ({d.registrationCouncil})
                        </p>
                    </div>
                </Card>

                {/* Slot Picker Section */}
                <section aria-label="Available times" className="mt-8">
                    <div className="mb-6">
                        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-purple-100 bg-purple-50 px-4 py-1.5">
                            <Calendar className="h-4 w-4 text-primary" aria-hidden />
                            <span className="text-sm font-bold text-primary">Choose Your Time</span>
                        </div>
                        <h2 className="text-2xl font-black text-foreground md:text-3xl">Pick a time</h2>
                    </div>

                    <Card className="p-6 shadow-sm md:p-8">
                        {slotsApi.loading && (
                            <div className="space-y-4 animate-pulse">
                                <div className="grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-3">
                                    {Array.from({ length: 12 }).map((_, i) => (
                                        <div key={i} className="h-12 bg-gray-200 rounded-xl" />
                                    ))}
                                </div>
                            </div>
                        )}
                        {!slotsApi.loading && slotsApi.error && <ErrorState message={slotsApi.error} onRetry={slotsApi.refetch} />}
                        {!slotsApi.loading && !slotsApi.error && slots.length === 0 && (
                            <EmptyState
                                title="No free times in the next 14 days"
                                body="This doctor has nothing open right now."
                                action={<Link href="/consult" className="text-sm font-bold text-primary">See other doctors</Link>}
                            />
                        )}
                        {!slotsApi.error && slots.length > 0 && <SlotPicker slots={slots} selectedId={selectedId} onSelect={(s) => { setSelectedId(s.id); }} />}
                        {dropped && (
                            <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                                The time you chose was just taken. Please pick another.
                            </p>
                        )}
                    </Card>
                </section>

                {/* Desktop Bottom Bar */}
                {selected && (
                    <div className="mt-8 hidden items-center justify-between gap-4 rounded-2xl border border-border bg-white p-6 shadow-md md:flex">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Your Selected Time</p>
                            <p className="mt-1 text-lg font-black text-foreground">{formatIstDateTime(selected.startsAt)}</p>
                        </div>
                        <Button size="lg" onClick={goBook} className="bg-primary px-8 py-3 text-base font-extrabold">
                            Continue to Payment
                        </Button>
                    </div>
                )}
            </main>

            {/* Mobile Sticky Bottom Bar */}
            {selected && (
                <StickyBottomBar className="safe-area-bottom z-40 border-t border-gray-200 bg-white px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] md:hidden">
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Your Time</p>
                            <p className="truncate text-sm font-bold text-foreground">{formatIstDateTime(selected.startsAt)}</p>
                        </div>
                        <Button onClick={goBook} className="shrink-0 bg-primary px-6 py-3.5 font-extrabold">
                            Continue
                        </Button>
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
