'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BadgeCheck, Calendar, Stethoscope, Video, Lock, FileText } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { consult } from '@/lib/consult/api';
import { DoctorCard } from '@/components/consult/DoctorCard';
import { SpecialtyChips } from '@/components/consult/SpecialtyChips';
import { EmptyState, ErrorState, Skeleton } from '@/components/consult/States';
import { Button, Notice } from '@/components/ui';
import { resolveSpecialty, specialtyLabel } from '@/lib/home/specialties';
import { Footer } from '@/components/Footer';

// useSearchParams needs a Suspense boundary so the page can still be prerendered.
export default function ConsultHomePage() {
    return (
        <Suspense fallback={<main className="w-full"><Skeleton className="h-96" /></main>}>
            <ConsultHome />
        </Suspense>
    );
}

function ConsultHome() {
    // ?specialty=<slug or homepage key> (from the homepage specialty grid and search) preselects a filter.
    const wanted = useSearchParams().get('specialty');
    const [picked, setPicked] = useState<string | null | undefined>(undefined);
    const specialties = useApi(() => consult.specialties(), []);
    const fromUrl = specialties.data ? resolveSpecialty(wanted, specialties.data) : null;
    const specialtyId = picked !== undefined ? picked : (fromUrl?.id ?? null);
    const setSpecialtyId = (id: string | null) => setPicked(id);
    // Asked for a specialty this deployment does not offer yet: say so, and show everyone instead.
    const unmatched = !!wanted && picked === undefined && !!specialties.data && !fromUrl;
    const doctors = useApi(() => consult.doctors(specialtyId ?? undefined), [specialtyId]);

    return (
        <>
            <main className="w-full bg-surface pb-28 md:pb-24">
                {/* Header: calm and light, facts instead of badges (DESIGN.md "calm clinical"). */}
                <section className="border-b border-border bg-surface-subtle">
                    <div className="container mx-auto max-w-7xl px-4 py-10 md:py-14">
                        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                            <div className="max-w-2xl space-y-3">
                                <p className="flex items-center gap-2 text-sm font-medium text-primary">
                                    <Stethoscope className="h-4 w-4" aria-hidden /> Doctor consultation
                                </p>
                                <h1 className="text-3xl font-semibold text-ink md:text-4xl">Talk to a doctor from home</h1>
                                <p className="text-base text-ink-muted md:text-lg">
                                    Registered doctors on video or audio. Book a time that suits you and get your prescription on your phone.
                                </p>
                            </div>
                            <Link
                                href="/consult/my"
                                className="inline-flex h-11 w-fit items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                My consultations
                            </Link>
                        </div>

                        <ul className="mt-8 grid gap-3 text-sm text-ink-muted sm:grid-cols-3">
                            <li className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-primary" aria-hidden /> Verified registration</li>
                            <li className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" aria-hidden /> Digital prescription after the call</li>
                            <li className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" aria-hidden /> Private and confidential</li>
                        </ul>
                    </div>
                </section>

                {/* How it works: three plain steps. */}
                <section aria-label="How it works" className="border-b border-border bg-surface">
                    <ol className="container mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:grid-cols-3">
                        {[
                            { icon: Stethoscope, text: 'Pick a doctor' },
                            { icon: Calendar, text: 'Choose a time' },
                            { icon: Video, text: 'Talk on video or audio' },
                        ].map(({ icon: Icon, text }, i) => (
                            <li key={text} className="flex items-center gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-medium text-primary">{i + 1}</span>
                                <Icon className="h-5 w-5 text-ink-subtle" aria-hidden />
                                <span className="text-sm font-medium text-ink">{text}</span>
                            </li>
                        ))}
                    </ol>
                </section>

                <div className="container mx-auto max-w-7xl px-4 py-12 md:py-16">
                    {/* Unmatched Warning */}
                    {unmatched && (
                        <Notice tone="warning" className="mb-6">
                            We don&apos;t have {specialtyLabel(wanted)} doctors on DocNow yet. Here are all our doctors; a General Physician can advise you and refer you if needed.
                        </Notice>
                    )}

                    {/* Specialty Filter */}
                    {specialties.data && specialties.data.length > 0 && (
                        <div className="mb-8">
                            <h2 className="mb-4 text-xl font-semibold text-ink">Choose by specialty</h2>
                            <SpecialtyChips specialties={specialties.data} value={specialtyId} onChange={setSpecialtyId} />
                        </div>
                    )}

                    {/* Doctors Grid */}
                    <div>
                        <div className="mb-6 flex items-center justify-between">
                            <h2 className="text-xl font-semibold text-ink">
                                {specialtyId ? 'Available doctors' : 'Our doctors'}
                            </h2>
                            {/* My Consultations Link - Mobile */}

                        </div>

                        <section
                            aria-label="Doctors"
                            aria-busy={doctors.loading}
                            className="grid gap-4 md:grid-cols-2 md:gap-6"
                        >
                            {doctors.loading && (
                                <>
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex gap-4 rounded-xl border border-border bg-surface p-5">
                                            <Skeleton className="h-16 w-16 shrink-0 rounded-xl" />
                                            <div className="min-w-0 flex-1 space-y-2">
                                                <Skeleton className="h-5 w-2/3" />
                                                <Skeleton className="h-4 w-1/3" />
                                                <Skeleton className="h-4 w-full" />
                                                <Skeleton className="h-5 w-24" />
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}
                            {!doctors.loading && doctors.error && (
                                <div className="md:col-span-2">
                                    <ErrorState message={doctors.error} onRetry={doctors.refetch} />
                                </div>
                            )}
                            {!doctors.loading && !doctors.error && doctors.data?.length === 0 && (
                                <div className="md:col-span-2">
                                    <EmptyState
                                        title="No doctors found"
                                        body={specialtyId ? 'No doctors are available for this specialty right now.' : 'No doctors are available right now. Please check back soon.'}
                                        action={specialtyId ? <Button variant="secondary" size="sm" onClick={() => setSpecialtyId(null)}>Show all doctors</Button> : undefined}
                                    />
                                </div>
                            )}
                            {!doctors.loading && !doctors.error && doctors.data?.map((d) => <DoctorCard key={d.id} doctor={d} />)}
                        </section>
                    </div>
                </div>
            </main>
            <Footer />
        </>
    );
}
