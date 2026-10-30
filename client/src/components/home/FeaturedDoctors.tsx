'use client';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, Briefcase, Languages, RefreshCw, Stethoscope, Video } from 'lucide-react';
import { DoctorAvatar } from '@/components/consult/DoctorCard';
import { formatRupees } from '@/lib/consult/format';
import type { DoctorSummary } from '@/lib/consult/types';
import { useDoctorDirectory } from './useDoctorDirectory';

const SHOWN = 8;

/**
 * One approved doctor. Every listed doctor passed DocNow's registration check, which is what
 * "Verified" means here; ratings and live availability are left out because we hold no such data.
 */
export function HomeDoctorCard({ doctor }: { doctor: DoctorSummary }) {
    return (
        <article data-testid={`home-doctor-${doctor.id}`} className="flex w-[280px] shrink-0 snap-start flex-col rounded-3xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-lg sm:w-auto">
            <div className="flex gap-4">
                <div className="relative">
                    <DoctorAvatar doctor={doctor} className="h-[72px] w-[72px] text-xl" />
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-white p-0.5" aria-hidden>
                        <BadgeCheck className="h-5 w-5 fill-emerald-500 text-white" />
                    </span>
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-extrabold text-gray-900">{doctor.displayName}</h3>
                    <p className="truncate text-sm font-bold text-primary">{doctor.specialty.name}</p>
                    <p className="line-clamp-2 text-xs text-gray-500">{doctor.qualification}</p>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-primary">
                    <Briefcase className="h-3.5 w-3.5" aria-hidden /> {doctor.experienceYears} yrs exp
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified Doctor
                </span>
            </div>
            {doctor.languages.length > 0 && (
                <p className="mt-3 flex items-center gap-1.5 truncate text-xs text-gray-500">
                    <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden /> {doctor.languages.join(', ')}
                </p>
            )}
            <div className="min-h-4 flex-1" />
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <div>
                    <p className="text-lg font-black text-gray-900">{formatRupees(doctor.consultationFee)}</p>
                    <p className="text-xs text-gray-500">{doctor.slotMinutes} min video consult</p>
                </div>
                <Link
                    href={`/consult/doctors/${doctor.id}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-white transition-colors hover:bg-[#3d1a7a]"
                    aria-label={`Book a slot with ${doctor.displayName}`}>
                    <Video className="h-4 w-4" aria-hidden /> Book Slot
                </Link>
            </div>
        </article>
    );
}

function CardSkeleton() {
    return <div aria-hidden className="h-[244px] w-[280px] shrink-0 animate-pulse rounded-3xl bg-gray-100 sm:w-auto" />;
}

/** Client island: approved doctors in a swipeable strip on phones and a grid on larger screens. */
export function FeaturedDoctors() {
    const { data, loading, error, refetch } = useDoctorDirectory();
    const doctors = (data ?? []).slice(0, SHOWN);

    return (
        <div aria-busy={loading}>
            {loading ? (
                <div className="-mx-4 flex gap-4 overflow-x-hidden px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => <CardSkeleton key={i} />)}
                </div>
            ) : error ? (
                <div role="alert" className="flex flex-col items-center gap-3 rounded-3xl border border-gray-100 bg-gray-50 p-8 text-center">
                    <p className="font-semibold text-gray-700">We could not load our doctors right now.</p>
                    <button type="button" onClick={() => void refetch()} className="inline-flex items-center gap-2 rounded-xl border border-primary px-4 py-2 text-sm font-bold text-primary hover:bg-primary/5">
                        <RefreshCw className="h-4 w-4" aria-hidden /> Try again
                    </button>
                </div>
            ) : doctors.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-3xl border border-gray-100 bg-gray-50 p-8 text-center">
                    <Stethoscope className="h-8 w-8 text-primary" aria-hidden />
                    <p className="font-semibold text-gray-700">New doctors are joining DocNow. Please check back soon.</p>
                </div>
            ) : (
                <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
                    {doctors.map((d) => <HomeDoctorCard key={d.id} doctor={d} />)}
                </div>
            )}
            {(data?.length ?? 0) > 0 && (
                <div className="mt-8 text-center">
                    <Link href="/consult" className="inline-flex items-center gap-2 font-bold text-primary hover:underline">
                        View all {data!.length} {data!.length === 1 ? 'doctor' : 'doctors'} <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                </div>
            )}
        </div>
    );
}
