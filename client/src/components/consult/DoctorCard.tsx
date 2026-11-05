import Link from 'next/link';
import { BadgeCheck, ChevronRight } from 'lucide-react';
import { formatRupees } from '@/lib/consult/format';
import type { DoctorSummary } from '@/lib/consult/types';

export function initials(name: string) {
    return name.replace(/^dr\.?\s+/i, '').split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

export function DoctorAvatar({ doctor, className = 'h-16 w-16 text-lg' }: { doctor: Pick<DoctorSummary, 'displayName' | 'photoUrl'>; className?: string }) {
    if (doctor.photoUrl) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={doctor.photoUrl} alt="" className={`${className} shrink-0 rounded-2xl object-cover`} />;
    }
    return (
        <div aria-hidden className={`${className} flex shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-bold text-primary`}>
            {initials(doctor.displayName)}
        </div>
    );
}

export function DoctorCard({ doctor }: { doctor: DoctorSummary }) {
    return (
        <Link
            href={`/consult/doctors/${doctor.id}`}
            className="group flex gap-5 rounded-2xl border border-border bg-white p-5 shadow-sm transition-all hover:scale-[1.02] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:p-6"
        >
            <DoctorAvatar doctor={doctor} className="h-20 w-20 text-xl md:h-20 md:w-20" />
            <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-foreground md:text-lg">{doctor.displayName}</h3>
                        <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600 md:h-5 md:w-5" aria-label="Verified" />
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />
                </div>
                <p className="mb-2 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary md:text-sm">
                    {doctor.specialty.name}
                </p>
                <p className="mb-1 text-sm text-muted-foreground md:text-base">{doctor.qualification}</p>
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:text-sm">
                    <span className="font-medium">
                        {doctor.experienceYears} {doctor.experienceYears === 1 ? 'year' : 'years'} experience
                    </span>
                    {doctor.languages.length > 0 && (
                        <>
                            <span aria-hidden>·</span>
                            <span className="font-medium">{doctor.languages.join(', ')}</span>
                        </>
                    )}
                </div>
                <div className="flex items-center justify-between">
                    <p className="text-lg font-black text-foreground md:text-xl">{formatRupees(doctor.consultationFee)}</p>
                    <span className="hidden text-sm font-bold text-primary md:inline-flex md:items-center md:gap-1">
                        Book Now
                        <ChevronRight className="h-4 w-4" aria-hidden />
                    </span>
                </div>
            </div>
        </Link>
    );
}
