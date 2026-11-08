'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { consult } from '@/lib/consult/api';
import { DoctorCard } from '@/components/consult/DoctorCard';
import { ConcernGrid } from '@/components/consult/home/ConcernGrid';
import { ConsultHeader } from '@/components/consult/home/ConsultHeader';
import { FamilyBooking } from '@/components/consult/home/FamilyBooking';
import { GoodToKnow } from '@/components/consult/home/GoodToKnow';
import { HowItWorks } from '@/components/consult/home/HowItWorks';
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
    // The header shows one real doctor; fetched unfiltered so it stays put while the list filters.
    const featured = useApi(() => consult.doctors(), []);
    const pickConcern = (id: string) => {
        setSpecialtyId(id);
        document.getElementById('doctors')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <>
            <main className="w-full bg-surface pb-28 md:pb-24">
                <ConsultHeader featured={featured.data?.[0]} loading={featured.loading} />

                <div className="space-y-16 pt-12 md:pt-20 lg:pt-28">
                {specialties.data && <ConcernGrid specialties={specialties.data} onPick={pickConcern} />}

                <div id="doctors" className="container mx-auto max-w-6xl scroll-mt-24 px-4">
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

                <HowItWorks />
                <FamilyBooking />
                <GoodToKnow />
                </div>
            </main>
            <Footer />
        </>
    );
}
