"use client";

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Check, Clock, Droplet, ShoppingCart } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import type { ChatProductCard } from '@/hooks/useSupportChat';
import { generateProductSlug } from '@/lib/mapProductDetails';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function productHref(card: Pick<ChatProductCard, 'name' | 'code' | 'type'>) {
    const base = card.type === 'PROFILE' ? 'profiles' : card.type === 'PACKAGE' ? 'packages' : 'tests';
    return `/${base}/${generateProductSlug(card.name, card.code)}`;
}

function newKey() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function CardRow({ card }: { card: ChatProductCard }) {
    const { cart, addToCart } = useCart();
    const { requireAuth } = useAuthGate();
    const [state, setState] = useState<'idle' | 'adding' | 'added'>('idle');
    // One key per intended add: a retry of the same tap reuses it, so the server adds once.
    const keyRef = useRef(newKey());
    const inCart = Boolean(cart?.items?.some((i) => i.testCode === card.code));

    const add = () => requireAuth(async () => {
        if (state === 'adding') return;
        setState('adding');
        const ok = await addToCart(card.code, card.name, card.price, card.mrp ?? undefined, { idempotencyKey: keyRef.current });
        if (ok) keyRef.current = newKey();
        setState(ok ? 'added' : 'idle');
    });

    const facts = [
        card.sampleType && { icon: Droplet, text: card.sampleType },
        card.reportTime && { icon: Clock, text: `Report ${card.reportTime}` },
    ].filter(Boolean) as { icon: typeof Clock; text: string }[];

    return (
        <li className="rounded-xl border border-gray-200 bg-white p-3">
            <Link href={productHref(card)} className="block font-semibold leading-snug text-gray-900 hover:text-primary hover:underline">
                {card.name}
            </Link>
            {facts.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
                    {facts.map(({ icon: Icon, text }) => (
                        <span key={text} className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden />{text}</span>
                    ))}
                </p>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
                <p className="leading-tight">
                    <span className="text-base font-bold tabular-nums text-gray-900">{rupees(card.price)}</span>
                    {card.mrp ? <span className="ml-1.5 text-xs text-gray-500 line-through">{rupees(card.mrp)}</span> : null}
                </p>
                {state === 'added' ? (
                    <Link href="/cart" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-sm font-medium text-emerald-700" aria-live="polite">
                        <Check className="h-4 w-4" aria-hidden /> In cart · View
                    </Link>
                ) : inCart ? (
                    <div className="flex items-center gap-2">
                        <Link href="/cart" className="text-sm font-medium text-primary hover:underline">In cart</Link>
                        <button type="button" onClick={add} disabled={state === 'adding'} className="inline-flex h-10 items-center rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60">
                            {state === 'adding' ? 'Adding…' : 'Add for another person'}
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={add}
                        disabled={state === 'adding'}
                        aria-label={`Add ${card.name} to cart, ${rupees(card.price)}`}
                        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                    >
                        <ShoppingCart className="h-4 w-4" aria-hidden />
                        {state === 'adding' ? 'Adding…' : 'Add to cart'}
                    </button>
                )}
            </div>
        </li>
    );
}

export function ChatProductCards({ cards }: { cards: ChatProductCard[] }) {
    if (cards.length === 0) return null;
    return (
        <ul aria-label="Tests found" className="mt-3 space-y-2">
            {cards.map((c) => <CardRow key={c.code} card={c} />)}
        </ul>
    );
}
