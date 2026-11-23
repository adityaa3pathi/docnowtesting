'use client';
import { useEffect, useState } from 'react';
import { Tag, X } from 'lucide-react';
import { consult, errorMessage } from '@/lib/consult/api';
import { formatPaise } from '@/lib/consult/format';
import type { ConsultPromoQuote } from '@/lib/consult/types';
import { Button, Card } from '@/components/ui';

interface Props {
    doctorId: string;
    slotId: string;
    applied: ConsultPromoQuote | null;
    onChange: (quote: ConsultPromoQuote | null) => void;
}

/**
 * "Have a promo code?" on the review-and-pay page. Apply asks the server what the code takes off
 * this doctor's fee; nothing is used up until the booking is made. Codes the patient can use with
 * this doctor are offered as one-tap chips.
 */
export function PromoBox({ doctorId, slotId, applied, onChange }: Props) {
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [offers, setOffers] = useState<ConsultPromoQuote[]>([]);

    useEffect(() => {
        let alive = true;
        consult.promos(doctorId).then((list) => { if (alive) setOffers(list); }).catch(() => { /* the box still works by typing */ });
        return () => {
            alive = false;
        };
    }, [doctorId]);

    async function apply(raw: string) {
        const code = raw.trim().toUpperCase();
        if (!code || busy) return;
        setBusy(true);
        setError(null);
        try {
            onChange(await consult.checkPromo(code, slotId));
            setInput('');
        } catch (e) {
            onChange(null);
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card className="mt-6 p-4">
            <h2 className="flex items-center gap-2 font-semibold text-ink">
                <Tag className="h-4 w-4 text-ink-subtle" aria-hidden /> Promo code
            </h2>
            {applied ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-primary-soft px-3 py-2 text-sm">
                    <span className="min-w-0">
                        <span className="font-semibold text-ink">{applied.code}</span> applied: {formatPaise(applied.discountPaise)} off
                        {applied.description && <span className="block truncate text-ink-muted">{applied.description}</span>}
                    </span>
                    <button
                        type="button"
                        onClick={() => onChange(null)}
                        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <X className="h-4 w-4" aria-hidden /> Remove
                    </button>
                </div>
            ) : (
                <>
                    <form
                        className="mt-3 flex gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void apply(input);
                        }}
                    >
                        <label htmlFor="consult-promo" className="sr-only">Promo code</label>
                        <input
                            id="consult-promo"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Enter code"
                            autoComplete="off"
                            maxLength={40}
                            className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm uppercase text-ink placeholder:normal-case placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-primary"
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? 'consult-promo-error' : undefined}
                        />
                        <Button type="submit" variant="outline" loading={busy} disabled={!input.trim()}>Apply</Button>
                    </form>
                    {error && <p id="consult-promo-error" role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
                    {offers.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Codes you can use">
                            {offers.map((o) => (
                                <li key={o.code}>
                                    <button
                                        type="button"
                                        onClick={() => void apply(o.code)}
                                        className="rounded-full border border-dashed border-primary px-3 py-1 text-xs font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                    >
                                        {o.code} · {formatPaise(o.discountPaise)} off
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </Card>
    );
}
