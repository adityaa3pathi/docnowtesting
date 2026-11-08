import Link from 'next/link';
import { BadgeCheck, Calendar, CreditCard, FileText, Lock, Video } from 'lucide-react';
import { DoctorAvatar } from '@/components/consult/DoctorCard';
import { Skeleton } from '@/components/ui';
import { formatRupees } from '@/lib/consult/format';
import type { DoctorSummary } from '@/lib/consult/types';

const PATH = [
    { icon: Calendar, text: 'Pick a time that suits you' },
    { icon: CreditCard, text: 'Pay securely with Razorpay' },
    { icon: Video, text: 'Join from your phone or laptop' },
];

/** A real doctor from the directory, never a made-up one: the card shows exactly what booking looks like. */
function PreviewCard({ doctor, loading }: { doctor?: DoctorSummary; loading: boolean }) {
    return (
        <div className="rounded-2xl border border-border bg-surface p-5 text-ink shadow-raised md:p-6">
            {loading || !doctor ? (
                <div className="space-y-3" aria-hidden>
                    <div className="flex gap-4"><Skeleton className="h-14 w-14 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /></div></div>
                    <Skeleton className="h-24 w-full" />
                </div>
            ) : (
                <>
                    <div className="flex items-start gap-4">
                        <DoctorAvatar doctor={doctor} className="h-14 w-14 text-base" />
                        <div className="min-w-0">
                            <p className="flex items-center gap-1.5 font-semibold">
                                {doctor.displayName}
                                <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" />
                            </p>
                            <p className="text-sm text-ink-muted">{doctor.specialty.name} · {doctor.qualification}</p>
                            <p className="mt-1 text-sm text-ink">
                                <span className="font-semibold tabular-nums">{formatRupees(doctor.consultationFee)}</span>
                                <span className="text-ink-muted"> · {doctor.slotMinutes} min consultation</span>
                            </p>
                        </div>
                    </div>
                    <ol className="mt-5 space-y-3 border-t border-border pt-5">
                        {PATH.map(({ icon: Icon, text }) => (
                            <li key={text} className="flex items-center gap-3 text-sm text-ink">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Icon className="h-4 w-4" aria-hidden /></span>
                                {text}
                            </li>
                        ))}
                    </ol>
                    <Link
                        href={`/consult/doctors/${doctor.id}`}
                        className="mt-5 flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        See {doctor.displayName.replace(/^dr\.?\s+/i, 'Dr. ')}&rsquo;s times
                    </Link>
                </>
            )}
        </div>
    );
}

/**
 * The signature band: solid deep brand purple (no gradient, no glass) with the preview card
 * overlapping its lower edge, so the page opens with confidence and then gets straight to work.
 */
export function ConsultHeader({ featured, loading }: { featured?: DoctorSummary; loading: boolean }) {
    return (
        <section className="relative bg-primary-hover text-on-primary">
            <div className="container mx-auto grid max-w-6xl gap-10 px-4 pb-24 pt-12 md:pb-28 md:pt-16 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:pb-20">
                <div className="space-y-6">
                    <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
                        Talk to a doctor from home
                    </h1>
                    <p className="max-w-lg text-lg text-primary-soft">
                        Registered doctors on video. Book a time that suits you and get your prescription on your phone.
                    </p>
                    <div className="flex flex-wrap gap-3">
                        <a
                            href="#doctors"
                            className="inline-flex h-12 items-center rounded-lg bg-surface px-6 text-base font-medium text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-primary focus-visible:ring-offset-2 focus-visible:ring-offset-primary-hover"
                        >
                            Find a doctor
                        </a>
                        <Link
                            href="/consult/my"
                            className="inline-flex h-12 items-center rounded-lg border border-on-primary/40 px-6 text-base font-medium text-on-primary transition-colors hover:bg-on-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-primary"
                        >
                            My consultations
                        </Link>
                    </div>
                    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-primary-soft">
                        <li className="flex items-center gap-2"><BadgeCheck className="h-4 w-4" aria-hidden /> Verified registration</li>
                        <li className="flex items-center gap-2"><FileText className="h-4 w-4" aria-hidden /> Digital prescription</li>
                        <li className="flex items-center gap-2"><Lock className="h-4 w-4" aria-hidden /> Private and confidential</li>
                    </ul>
                </div>
                <div className="relative lg:-mb-36">
                    <PreviewCard doctor={featured} loading={loading} />
                </div>
            </div>
        </section>
    );
}
