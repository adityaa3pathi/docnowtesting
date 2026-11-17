'use client';
import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { SUPPORT_PHONE_LINK } from '@/lib/supportConfig';
import { cn } from '@/lib/utils';
import type { CallCopy } from './callCopy';

const LATE_AFTER_MS = 10 * 60_000;

/** Shown while the other side hasn't joined. After 10 minutes the patient side offers support. */
export function WaitingRoom({ otherParty, copy, senior }: { otherParty: 'doctor' | 'patient'; copy: CallCopy; senior?: boolean }) {
    const [late, setLate] = useState(false);
    useEffect(() => {
        if (otherParty !== 'doctor') return;
        const t = setTimeout(() => setLate(true), LATE_AFTER_MS);
        return () => clearTimeout(t);
    }, [otherParty]);

    return (
        // Scrolls on short phone screens; m-auto centres without cutting off the top when it overflows.
        <div className="flex h-full overflow-y-auto px-6 py-8">
            <div className="m-auto max-w-md space-y-6 text-center">
                <div className="flex justify-center" aria-hidden>
                    <div className="relative h-20 w-20">
                        <div className="absolute inset-0 rounded-full border-4 border-white/20" />
                        <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-white motion-reduce:animate-none" />
                    </div>
                </div>
                <div role="status" className="space-y-2">
                    <p className={cn('font-semibold text-white', senior ? 'text-2xl' : 'text-lg')}>{copy.waitingFor[otherParty]}</p>
                    <p className={cn('text-white/80', senior ? 'text-lg' : 'text-sm')}>{copy.waitingHint[otherParty]}</p>
                </div>
                {late && (
                    <div role="alert" className="space-y-3 rounded-xl bg-amber-100 p-4 text-left">
                        <p className={cn('font-semibold text-amber-900', senior ? 'text-lg' : 'text-sm')}>{copy.late}</p>
                        <a href={`tel:${SUPPORT_PHONE_LINK}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-900 px-4 text-sm font-semibold text-white">
                            <Phone className="h-4 w-4" aria-hidden /> {copy.callSupport}
                        </a>
                    </div>
                )}
                {otherParty === 'doctor' ? (
                    <div className="space-y-2 rounded-xl bg-white/10 p-4 text-left">
                        <p className={cn('font-semibold text-white', senior ? 'text-base' : 'text-xs')}>{copy.tipsTitle}</p>
                        <ul className={cn('list-disc space-y-1 pl-4 text-white/85', senior ? 'text-base' : 'text-xs')}>
                            {copy.tips.map((tip) => <li key={tip}>{tip}</li>)}
                        </ul>
                    </div>
                ) : (
                    <p className="rounded-xl bg-white/10 p-4 text-xs text-white/85">{copy.doctorTip}</p>
                )}
            </div>
        </div>
    );
}
