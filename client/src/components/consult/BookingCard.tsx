import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { formatPaise } from '@/lib/consult/format';
import { formatIstDateTime } from '@/lib/consult/time';
import { statusInfo } from '@/lib/consult/status';
import { Badge } from './Badge';
import type { BookingView } from '@/lib/consult/types';

export function BookingCard({ booking, holdLive }: { booking: BookingView; holdLive?: boolean }) {
    const info = statusInfo(booking.status);
    const href = `/consult/booking/${booking.consultationId}`;
    // A second link, not inside the card's link (links can't nest).
    const canChange = booking.status === 'CONFIRMED' && booking.selfReschedule?.allowed;
    return (
        <div className="rounded-xl border border-border bg-surface">
            <Link href={href} className="block rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{booking.doctorName}</p>
                        <p className="text-sm text-ink-muted">{booking.specialty}</p>
                    </div>
                    <Badge tone={info.tone}>{info.label}</Badge>
                </div>
                <p className="mt-2 text-sm font-semibold text-ink">{formatIstDateTime(booking.startsAt)}</p>
                <p className="text-xs text-ink-muted">
                    For {booking.patientName} · {formatPaise(booking.amountPaise)}
                </p>
                {holdLive && <p className="mt-2 text-sm font-semibold text-primary">Continue to pay</p>}
            </Link>
            {canChange && (
                <div className="border-t border-border px-4 py-2">
                    <Link href={`${href}?change=1`} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <CalendarClock className="h-4 w-4" aria-hidden /> Change time
                    </Link>
                </div>
            )}
        </div>
    );
}
