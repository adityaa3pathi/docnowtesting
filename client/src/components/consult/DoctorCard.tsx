import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { formatRupees } from '@/lib/consult/format';
import type { DoctorSummary } from '@/lib/consult/types';

export function initials(name: string) {
    return name.replace(/^dr\.?\s+/i, '').split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

export function DoctorAvatar({ doctor, className = 'h-16 w-16 text-lg' }: { doctor: Pick<DoctorSummary, 'displayName' | 'photoUrl'>; className?: string }) {
    if (doctor.photoUrl) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={doctor.photoUrl} alt="" className={`${className} shrink-0 rounded-xl object-cover`} />;
    }
    return (
        <div aria-hidden className={`${className} flex shrink-0 items-center justify-center rounded-xl bg-primary-soft font-semibold text-primary`}>
            {initials(doctor.displayName)}
        </div>
    );
}

export function DoctorCard({ doctor }: { doctor: DoctorSummary }) {
    const years = `${doctor.experienceYears} ${doctor.experienceYears === 1 ? 'year' : 'years'}`;
    return (
        <Link
            href={`/consult/doctors/${doctor.id}`}
            className="group flex gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:p-5"
        >
            <DoctorAvatar doctor={doctor} className="h-14 w-14 text-base md:h-16 md:w-16 md:text-lg" />
            <div className="min-w-0 flex-1 space-y-1">
                <h3 className="flex items-center gap-1.5 font-semibold text-ink">
                    {doctor.displayName}
                    <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" />
                </h3>
                <p className="text-sm text-ink-muted">{doctor.specialty.name} · {doctor.qualification}</p>
                {/* One quiet fact line instead of pills (DESIGN.md signature). */}
                <p className="text-sm text-ink-muted">
                    {years} experience{doctor.languages.length > 0 ? ` · ${doctor.languages.join(', ')}` : ''}
                </p>
                {/* The price says what it buys; "Book now" is the one forward sign (no extra arrow). */}
                <div className="flex items-end justify-between gap-3 pt-2">
                    <p className="text-ink">
                        <span className="text-lg font-semibold tabular-nums">{formatRupees(doctor.consultationFee)}</span>
                        <span className="text-sm text-ink-muted"> · {doctor.slotMinutes} min consultation</span>
                    </p>
                    <span className="shrink-0 text-sm font-medium text-primary group-hover:underline">Book now</span>
                </div>
            </div>
        </Link>
    );
}
