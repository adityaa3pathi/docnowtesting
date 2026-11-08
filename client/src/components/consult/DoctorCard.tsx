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
            className="group flex gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
            <DoctorAvatar doctor={doctor} className="h-16 w-16 text-lg" />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <h3 className="flex items-center gap-1.5 font-semibold text-ink">
                            {doctor.displayName}
                            <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" />
                        </h3>
                        <p className="text-sm text-ink-muted">{doctor.specialty.name} · {doctor.qualification}</p>
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-ink-subtle" aria-hidden />
                </div>
                {/* One quiet fact line instead of pills (DESIGN.md signature). */}
                <p className="text-sm text-ink-muted">
                    {years} experience{doctor.languages.length > 0 ? ` · ${doctor.languages.join(', ')}` : ''}
                </p>
                <div className="flex items-center justify-between pt-2">
                    <p className="text-lg font-semibold text-ink">{formatRupees(doctor.consultationFee)}</p>
                    <span className="text-sm font-medium text-primary group-hover:underline">Book now</span>
                </div>
            </div>
        </Link>
    );
}
