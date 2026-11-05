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
            <main className="w-full bg-white pb-16 md:pb-24">
                {/* Hero Section */}
                <section
                    className="relative pb-16 pt-16 md:pb-24 md:pt-20"
                    style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
                >
                    <div className="container mx-auto max-w-7xl px-4">
                        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 backdrop-blur-sm">
                            <Stethoscope className="h-4 w-4 text-white" aria-hidden />
                            <span className="text-sm font-bold text-white">Video Doctor Consultation</span>
                        </div>
                        <h1 className="mb-4 max-w-3xl text-4xl font-black text-white md:text-6xl">
                            Talk to a Doctor from Home
                        </h1>
                        <p className="mb-8 max-w-2xl text-lg font-medium text-white/90 md:text-xl">
                            Certified, verified doctors. Book a video slot, get a digital prescription.
                        </p>

                        {/* Trust Strip */}
                        <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-white/80 md:gap-6">
                            <div className="flex items-center gap-2">
                                <BadgeCheck className="h-5 w-5 text-emerald-400" aria-hidden />
                                <span>Verified Registration</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <FileText className="h-5 w-5 text-blue-400" aria-hidden />
                                <span>Digital Prescription</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Lock className="h-5 w-5 text-purple-400" aria-hidden />
                                <span>Private & Confidential</span>
                            </div>
                        </div>

                        {/* My Consultations Button - Desktop */}
                        <div className="absolute right-8 top-8 hidden md:block">
                            <Link
                                href="/consult/my"
                                className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3 font-bold text-white backdrop-blur-sm transition-all hover:bg-white/20"
                            >
                                My Consultations
                            </Link>
                        </div>
                    </div>
                </section>

                {/* How It Works */}
                <section className="border-b border-border bg-white py-8">
                    <div className="container mx-auto max-w-7xl px-4">
                        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-12">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
                                    <Stethoscope className="h-5 w-5 text-primary" aria-hidden />
                                </div>
                                <span className="text-sm font-bold text-foreground">1. Pick a Doctor</span>
                            </div>
                            <div className="hidden text-muted-foreground md:block">→</div>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                                    <Calendar className="h-5 w-5 text-blue-600" aria-hidden />
                                </div>
                                <span className="text-sm font-bold text-foreground">2. Choose a Time</span>
                            </div>
                            <div className="hidden text-muted-foreground md:block">→</div>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                                    <Video className="h-5 w-5 text-emerald-600" aria-hidden />
                                </div>
                                <span className="text-sm font-bold text-foreground">3. Video Consult</span>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="container mx-auto max-w-7xl px-4 py-12 md:py-16">
                    {/* Unmatched Warning */}
                    {unmatched && (
                        <div role="status" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 shadow-sm">
                            <p className="text-sm font-medium text-amber-900">
                                We don&apos;t have {specialtyLabel(wanted)} doctors on DocNow yet. Here are all our doctors; a General Physician can advise you and refer you if needed.
                            </p>
                        </div>
                    )}

                    {/* Specialty Filter */}
                    {specialties.data && specialties.data.length > 0 && (
                        <div className="mb-8">
                            <h2 className="mb-4 text-2xl font-black text-foreground">Choose by Specialty</h2>
                            <SpecialtyChips specialties={specialties.data} value={specialtyId} onChange={setSpecialtyId} />
                        </div>
                    )}

                    {/* Doctors Grid */}
                    <div>
                        <div className="mb-6 flex items-center justify-between">
                            <h2 className="text-2xl font-black text-foreground">
                                {specialtyId ? 'Available Doctors' : 'Our Doctors'}
                            </h2>
                            {/* My Consultations Link - Mobile */}
                            <Link
                                href="/consult/my"
                                className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-primary hover:bg-accent md:hidden"
                            >
                                My Consultations
                            </Link>
                        </div>

                        <section
                            aria-label="Doctors"
                            aria-busy={doctors.loading}
                            className="grid gap-4 md:grid-cols-2 md:gap-6"
                        >
                            {doctors.loading && (
                                <>
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex gap-5 rounded-2xl border border-border bg-white p-5 shadow-sm animate-pulse md:p-6">
                                            <div className="h-20 w-20 shrink-0 rounded-2xl bg-gray-200" />
                                            <div className="min-w-0 flex-1">
                                                <div className="mb-1 flex items-start justify-between gap-2">
                                                    <div className="h-5 w-3/4 bg-gray-200 rounded" />
                                                    <div className="h-5 w-5 shrink-0 bg-gray-200 rounded-full" />
                                                </div>
                                                <div className="mb-2 h-5 w-32 bg-gray-200 rounded-full" />
                                                <div className="mb-1 h-4 w-full bg-gray-200 rounded" />
                                                <div className="mb-3 h-4 w-2/3 bg-gray-200 rounded" />
                                                <div className="flex items-center justify-between">
                                                    <div className="h-6 w-20 bg-gray-200 rounded" />
                                                    <div className="h-5 w-24 bg-gray-200 rounded" />
                                                </div>
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
                                        action={specialtyId ? <button type="button" onClick={() => setSpecialtyId(null)} className="text-sm font-bold text-primary">Show all doctors</button> : undefined}
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
