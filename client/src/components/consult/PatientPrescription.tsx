'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui';
import { useCart } from '@/contexts/CartContext';
import { useApi } from '@/hooks/useApi';
import { consult, errorMessage } from '@/lib/consult/api';
import type { CartAddResult, Prescription } from '@/lib/consult/types';
import { PrescriptionView } from './PrescriptionView';
import { ErrorState, LoadingBlock } from './States';

function CartResult({ result, prescription }: { result: CartAddResult; prescription: Prescription }) {
    const name = (code: string) => prescription.recommendedTests.find((t) => t.code === code)?.name ?? code;
    return (
        <div role="status" className="space-y-1 rounded-xl bg-primary/5 px-4 py-3 text-sm">
            {result.added.length > 0 && <p className="font-semibold text-foreground">Added to cart: {result.added.map(name).join(', ')}</p>}
            {result.skipped.map((s) => <p key={s.code} className="text-muted-foreground">{name(s.code)}: {s.reason}</p>)}
            <Link href="/cart" className="inline-block font-bold text-primary">Go to cart</Link>
        </div>
    );
}

export function PatientPrescription({ bookingId }: { bookingId: string }) {
    const { data, error, loading, refetch } = useApi(() => consult.prescription(bookingId), [bookingId]);
    const { refreshCart } = useCart();
    const [busy, setBusy] = useState<'pdf' | 'cart' | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [cart, setCart] = useState<CartAddResult | null>(null);

    async function run(kind: 'pdf' | 'cart') {
        setBusy(kind);
        setActionError(null);
        try {
            if (kind === 'pdf') await consult.downloadPrescription(bookingId);
            else {
                setCart(await consult.addTestsToCart(bookingId));
                void refreshCart();
            }
        } catch (e) {
            // The PDF helper throws a plain Error carrying the server's message.
            setActionError(errorMessage(e, e instanceof Error ? e.message : undefined));
        } finally {
            setBusy(null);
        }
    }

    if (loading) return <LoadingBlock label="Loading your prescription" />;
    if (error || !data) return <ErrorState message={error ?? 'We could not load your prescription.'} onRetry={refetch} />;

    return (
        <section aria-label="Prescription" className="space-y-4 rounded-2xl border border-border bg-white p-4">
            <h2 className="text-lg font-bold text-foreground">Your prescription</h2>
            <PrescriptionView prescription={data} />
            <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="flex-1" disabled={busy !== null} onClick={() => void run('pdf')}>
                    {busy === 'pdf' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-2 h-4 w-4" aria-hidden />}
                    Download prescription (PDF)
                </Button>
                {data.recommendedTests.length > 0 && (
                    <Button className="flex-1" disabled={busy !== null} onClick={() => void run('cart')}>
                        {busy === 'cart' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />}
                        Add recommended tests to cart
                    </Button>
                )}
            </div>
            {actionError && <p role="alert" className="text-sm font-semibold text-destructive">{actionError}</p>}
            {cart && <CartResult result={cart} prescription={data} />}
        </section>
    );
}
