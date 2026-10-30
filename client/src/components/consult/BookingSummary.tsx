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
        <dl className="space-y-3 rounded-2xl border border-border bg-white p-4 text-sm shadow-sm">
            <div>
                <dt className="text-xs text-muted-foreground">Doctor</dt>
                <dd className="font-bold text-foreground">{doctorName}</dd>
                <dd className="text-muted-foreground">{specialty}</dd>
            </div>
            <div>
                <dt className="text-xs text-muted-foreground">When (Indian time)</dt>
                <dd className="font-semibold text-foreground">
                    {formatIstDateTime(startsAt)} to {formatIstTime(endsAt)}
                </dd>
            </div>
            {personName && (
                <div>
                    <dt className="text-xs text-muted-foreground">Visit is for</dt>
                    <dd className="font-semibold text-foreground">{personName}</dd>
                </div>
            )}
            <div className="flex items-center justify-between border-t border-border pt-3">
                <dt className="font-semibold">{amountLabel}</dt>
                <dd className="text-lg font-black text-foreground">{amount}</dd>
            </div>
        </dl>
    );
}
