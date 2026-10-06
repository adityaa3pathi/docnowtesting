'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { consult } from '@/lib/consult/api';
import { DoctorCard } from '@/components/consult/DoctorCard';
import { SpecialtyChips } from '@/components/consult/SpecialtyChips';
import { EmptyState, ErrorState, Skeleton } from '@/components/consult/States';

export default function ConsultHomePage() {
    const [specialtyId, setSpecialtyId] = useState<string | null>(null);
    const specialties = useApi(() => consult.specialties(), []);
    const doctors = useApi(() => consult.doctors(specialtyId ?? undefined), [specialtyId]);

    return (
        <main className="mx-auto w-full max-w-3xl px-4 py-6">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Talk to a doctor</h1>
                    <p className="mt-1 text-sm text-muted-foreground">Pick a doctor, choose a time and pay to book.</p>
                </div>
                <Link href="/consult/my" className="shrink-0 rounded-xl border border-border bg-white px-3 py-2 text-sm font-semibold text-primary hover:bg-accent">
                    My consultations
                </Link>
            </div>

            {specialties.data && specialties.data.length > 0 && (
                <div className="mt-5">
                    <SpecialtyChips specialties={specialties.data} value={specialtyId} onChange={setSpecialtyId} />
                </div>
            )}

            <section aria-label="Doctors" aria-busy={doctors.loading} className="mt-5 space-y-3">
                {doctors.loading && (
                    <>
                        <Skeleton className="h-28" />
                        <Skeleton className="h-28" />
                        <Skeleton className="h-28" />
                    </>
                )}
                {!doctors.loading && doctors.error && <ErrorState message={doctors.error} onRetry={doctors.refetch} />}
                {!doctors.loading && !doctors.error && doctors.data?.length === 0 && (
                    <EmptyState
                        title="No doctors found"
                        body={specialtyId ? 'No doctors are available for this specialty right now.' : 'No doctors are available right now. Please check back soon.'}
                        action={specialtyId ? <button type="button" onClick={() => setSpecialtyId(null)} className="text-sm font-bold text-primary">Show all doctors</button> : undefined}
                    />
                )}
                {!doctors.loading && !doctors.error && doctors.data?.map((d) => <DoctorCard key={d.id} doctor={d} />)}
            </section>
        </main>
    );
}
