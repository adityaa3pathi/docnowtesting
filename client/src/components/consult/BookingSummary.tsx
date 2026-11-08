import { formatIstDateTime, formatIstTime } from '@/lib/consult/time';

interface Props {
    doctorName: string;
    specialty: string;
    startsAt: string;
    endsAt: string;
    /** Already formatted, so paise and rupees are never mixed here. */
    amount: string;
    amountLabel?: string;
    personName?: string;
}

export function BookingSummary({ doctorName, specialty, startsAt, endsAt, amount, amountLabel = 'Fee', personName }: Props) {
    return (
        <dl className="space-y-3 rounded-xl border border-border bg-surface p-4 text-sm">
            <div>
                <dt className="text-xs text-ink-muted">Doctor</dt>
                <dd className="font-semibold text-ink">{doctorName}</dd>
                <dd className="text-ink-muted">{specialty}</dd>
            </div>
            <div>
                <dt className="text-xs text-ink-muted">When (Indian time)</dt>
                <dd className="font-semibold text-ink">
                    {formatIstDateTime(startsAt)} to {formatIstTime(endsAt)}
                </dd>
            </div>
            {personName && (
                <div>
                    <dt className="text-xs text-ink-muted">Visit is for</dt>
                    <dd className="font-semibold text-ink">{personName}</dd>
                </div>
            )}
            <div className="flex items-center justify-between border-t border-border pt-3">
                <dt className="font-semibold">{amountLabel}</dt>
                <dd className="text-lg font-semibold text-ink">{amount}</dd>
            </div>
        </dl>
    );
}
