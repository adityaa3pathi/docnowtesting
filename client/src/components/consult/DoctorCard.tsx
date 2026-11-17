import Link from 'next/link';
import { ArrowRight, BadgeCheck, BriefcaseMedical, CalendarClock, Languages } from 'lucide-react';
import { formatRupees } from '@/lib/consult/format';
import { nextFreeLabel } from '@/lib/consult/time';
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

function NextFree({ iso }: { iso: string | null }) {
    if (!iso) {
        return <p className="flex items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2 text-sm text-ink-muted"><CalendarClock className="h-4 w-4 shrink-0" aria-hidden />No open times right now</p>;
    }
    return (
        <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success-ink">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
            <span>Next free <strong className="font-bold">{nextFreeLabel(iso)}</strong></span>
        </p>
    );
}

export function DoctorCard({ doctor }: { doctor: DoctorSummary }) {
    const years = `${doctor.experienceYears} ${doctor.experienceYears === 1 ? 'year' : 'years'}`;
    return (
        <Link
            href={`/consult/doctors/${doctor.id}`}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
            <div className="flex gap-4 p-4 md:p-5">
                <DoctorAvatar doctor={doctor} className="h-16 w-16 text-lg md:h-20 md:w-20 md:text-xl" />
                <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-1.5 text-lg font-bold leading-snug text-ink">
                        {doctor.displayName}
                        <BadgeCheck className="h-5 w-5 shrink-0 text-primary" aria-label="Verified" />
                    </h3>
                    <p className="mt-0.5 text-sm font-semibold text-primary">{doctor.specialty.name}</p>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">{doctor.qualification}</p>
                    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                        <li className="flex items-center gap-1.5"><BriefcaseMedical className="h-4 w-4 shrink-0" aria-hidden />{years} experience</li>
                        {doctor.languages.length > 0 && (
                            <li className="flex items-center gap-1.5"><Languages className="h-4 w-4 shrink-0" aria-hidden />{doctor.languages.join(', ')}</li>
                        )}
                    </ul>
                </div>
            </div>
            {doctor.nextSlotAt !== undefined && <div className="px-4 pb-4 md:px-5"><NextFree iso={doctor.nextSlotAt} /></div>}
            {/* The whole card is the link, so the button is a styled span (no nested interactive). */}
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-border bg-surface-subtle px-4 py-3 md:px-5">
                <p className="leading-tight">
                    <span className="block text-xl font-bold tabular-nums text-ink">{formatRupees(doctor.consultationFee)}</span>
                    <span className="text-sm text-ink-muted">{doctor.slotMinutes} min video call</span>
                </p>
                <span className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary transition-colors group-hover:bg-primary-hover">
                    Book now
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                </span>
            </div>
        </Link>
    );
}
