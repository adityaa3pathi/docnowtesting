'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { instant } from '@/lib/consult/api';
import { docsOnline, feeRange } from '@/lib/consult/instant';
import { formatPaise } from '@/lib/consult/format';
import { nextFreeLabel } from '@/lib/consult/time';
import type { InstantAvailability } from '@/lib/consult/types';

const REFRESH_MS = 30_000;

/**
 * "Consult a Doc now" in the purple header: how many Docs are online right now and the fee range.
 * With nobody online it says so and points at the next bookable GP time instead. Hidden until the
 * first answer, and when this deployment has no GP specialty.
 */
export function InstantCard() {
    const [a, setA] = useState<InstantAvailability | null>(null);
    useEffect(() => {
        let alive = true;
        const load = () => instant.availability().then((r) => alive && setA(r)).catch(() => { /* the card just stays as it was */ });
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, []);
    if (!a?.specialty) return null;

    const fees = feeRange(a);
    return (
        <div className="max-w-lg rounded-2xl bg-surface p-4 text-ink shadow-raised" aria-live="polite">
            {a.online > 0 ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="flex items-center gap-2 font-semibold">
                            <span className="relative flex h-2.5 w-2.5" aria-hidden>
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
                                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                            </span>
                            {docsOnline(a.online)}
                        </p>
                        <p className="mt-0.5 text-sm text-ink-muted">
                            We connect you to the first Doc who is free.{fees ? ` Fee ${fees}, shown before you pay.` : ''}
                        </p>
                    </div>
                    <Link
                        href="/consult/now"
                        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        <Zap className="h-4 w-4" aria-hidden /> Consult a Doc now
                    </Link>
                </div>
            ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="font-semibold">No Doc is free right now</p>
                        <p className="mt-0.5 text-sm text-ink-muted">
                            {a.nextSlot
                                ? `Next available: ${nextFreeLabel(a.nextSlot.startsAt)} with ${a.nextSlot.doctorName} · ${formatPaise(a.nextSlot.feePaise)}`
                                : 'Book a time with any doctor below.'}
                        </p>
                    </div>
                    {a.nextSlot && (
                        <Link
                            href={`/consult/doctors/${a.nextSlot.doctorId}`}
                            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-border px-5 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Book a time
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}
