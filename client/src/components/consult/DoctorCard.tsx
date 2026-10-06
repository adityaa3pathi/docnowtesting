import Link from 'next/link';
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
            className="flex gap-4 rounded-2xl border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
            <DoctorAvatar doctor={doctor} />
            <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-foreground">{doctor.displayName}</p>
                <p className="text-sm font-semibold text-primary">{doctor.specialty.name}</p>
                <p className="truncate text-sm text-muted-foreground">{doctor.qualification}</p>
                <p className="text-xs text-muted-foreground">
                    {doctor.experienceYears} {doctor.experienceYears === 1 ? 'year' : 'years'} experience
                    {doctor.languages.length > 0 && ` · ${doctor.languages.join(', ')}`}
                </p>
                <p className="mt-1 text-sm font-bold text-foreground">{formatRupees(doctor.consultationFee)}</p>
            </div>
        </Link>
    );
}
