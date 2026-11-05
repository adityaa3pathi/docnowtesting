'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { CONFIRMING_MESSAGE, HOLD_ENDED_MESSAGE, VERIFY_MESSAGES, toneClasses, type Tone } from '@/lib/consult/status';
import type { ResultKind } from '@/lib/consult/bookingFlow';

interface Props {
    result: ResultKind;
    /** True right after paying, so we celebrate. Later visits show a plain detail heading. */
    fresh: boolean;
    statusLabel: string;
    doctorId: string;
}

function copy(result: ResultKind, fresh: boolean, statusLabel: string): { title: string; body: string; tone: Tone } {
    switch (result) {
        case 'booked':
            return fresh ? VERIFY_MESSAGES.confirmed : { title: statusLabel, body: '', tone: 'success' };
        case 'refund':
            return VERIFY_MESSAGES.refund_created;
        case 'checking':
            return VERIFY_MESSAGES.flagged;
        case 'hold_ended':
            return { title: 'This hold ended', body: HOLD_ENDED_MESSAGE, tone: 'muted' };
        case 'still_confirming':
            return { title: 'We are still confirming your payment', body: 'This is taking longer than usual. Please do not pay again. It will show in My consultations once confirmed.', tone: 'warning' };
        default:
            return { title: statusLabel, body: '', tone: 'muted' };
    }
}

/** One message per outcome, in a polite live region. Focus moves to the heading so screen readers read it. */
export function PaymentStatus({ result, fresh, statusLabel, doctorId }: Props) {
    const heading = useRef<HTMLHeadingElement>(null);
    const { title, body, tone } = copy(result, fresh, statusLabel);
    useEffect(() => {
        if (fresh) heading.current?.focus();
    }, [result, fresh]);

    return (
        <div role="status" aria-live="polite" className={`rounded-2xl p-4 ${toneClasses[tone]}`}>
            <h1 ref={heading} tabIndex={-1} className="text-lg font-bold outline-none">{title}</h1>
            {body && <p className="mt-1 text-sm">{body}</p>}
            <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold">
                <Link href="/consult/my" className="underline">My consultations</Link>
                {result === 'hold_ended' && <Link href={`/consult/doctors/${doctorId}`} className="underline">Pick a new time</Link>}
            </div>
        </div>
    );
}

export function ConfirmingNotice() {
    return (
        <div role="status" className="rounded-2xl bg-amber-100 p-4 text-amber-900">
            <p className="font-bold">{CONFIRMING_MESSAGE}</p>
            <p className="mt-1 text-sm">This usually takes a few seconds.</p>
        </div>
    );
}
