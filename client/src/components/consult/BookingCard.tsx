import Link from 'next/link';
import { formatPaise } from '@/lib/consult/format';
import { formatIstDateTime } from '@/lib/consult/time';
import { statusInfo } from '@/lib/consult/status';
import { Badge } from './Badge';
import type { BookingView } from '@/lib/consult/types';

export function BookingCard({ booking, holdLive }: { booking: BookingView; holdLive?: boolean }) {
    const info = statusInfo(booking.status);
    return (
        <Link
            href={`/consult/booking/${booking.consultationId}`}
            className="block rounded-xl border border-border bg-surface p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
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
    );
}
