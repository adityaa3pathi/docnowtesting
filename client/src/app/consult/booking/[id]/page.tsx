'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { useBookingFlow } from '@/hooks/useBookingFlow';
import { formatPaise } from '@/lib/consult/format';
import { formatCountdown } from '@/lib/consult/bookingFlow';
import { statusInfo } from '@/lib/consult/status';
import { BookingSummary } from '@/components/consult/BookingSummary';
import { CancelDialog } from '@/components/consult/CancelDialog';
import { ConfirmingNotice, PaymentStatus } from '@/components/consult/PaymentStatus';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { Button } from '@/components/ui';
import type { BookingView } from '@/lib/consult/types';

const REFUND_TEXT = {
    PENDING: 'Refund on its way',
    PROCESSED: 'Refund sent to your original payment method',
    FAILED: 'Refund needs a manual step. Our team has been told.',
} as const;

function RefundLine({ booking }: { booking: BookingView }) {
    if (booking.refundPaise <= 0) return null;
    return (
        <p className="rounded-xl bg-primary/5 px-4 py-3 text-sm font-semibold">
            {formatPaise(booking.refundPaise)}: {booking.refundStatus ? REFUND_TEXT[booking.refundStatus] : 'Refund being prepared'}
        </p>
    );
}

function BookingDetail() {
    const { id } = useParams<{ id: string }>();
    const autoPay = useSearchParams().get('pay') === '1';
    const { isAuthenticated, isInitialized } = useAuth();
    const { openAuthDialog } = useAuthGate();
    const flow = useBookingFlow(id, isInitialized && isAuthenticated);
    const [cancelOpen, setCancelOpen] = useState(false);
    const autoOpened = useRef(false);
    const { booking, decision, pay } = flow;

    // Opens the payment window once, right after the booking is created.
    useEffect(() => {
        if (autoPay && !autoOpened.current && decision?.kind === 'pay') {
            autoOpened.current = true;
            void pay();
        }
    }, [autoPay, decision?.kind, pay]);

    if (!isInitialized) return <LoadingBlock />;
    if (!isAuthenticated) {
        return (
            <main className="mx-auto max-w-md px-4 py-10 text-center">
                <h1 className="text-xl font-bold">Log in to see this booking</h1>
                <p className="mt-2 text-sm text-muted-foreground">If you paid, your booking is safe. Log in to see where it stands.</p>
                <Button className="mt-4" onClick={openAuthDialog}>Log in</Button>
            </main>
        );
    }
    if (flow.loading && !booking) return <LoadingBlock />;
    if (!booking || !decision) {
        return (
            <main className="mx-auto max-w-md px-4 py-10">
                <ErrorState message={flow.error?.message ?? 'We could not load this booking.'} onRetry={() => void flow.refetch()} />
                <p className="mt-4 text-center text-sm"><Link href="/consult/my" className="font-bold text-primary">My consultations</Link></p>
            </main>
        );
    }

    const info = statusInfo(booking.status);
    const fresh = autoPay || flow.paidHere;
    const summary = (
        <BookingSummary
            doctorName={booking.doctorName}
            specialty={booking.specialty}
            startsAt={booking.startsAt}
            endsAt={booking.endsAt}
            personName={booking.patientName}
            amount={formatPaise(booking.amountPaise)}
            amountLabel="Amount"
        />
    );
    const paidButUnsettled = booking.status === 'PENDING_PAYMENT' && (booking.paymentCaptured || flow.paidHere);
    const canCancel = info.canCancel && decision.kind !== 'poll' && !booking.underStaffCheck && !paidButUnsettled;

    return (
        <main className="mx-auto w-full max-w-lg px-4 py-6">
            <Link href="/consult/my" className="text-sm font-semibold text-primary">&larr; My consultations</Link>
            <div className="mt-4 space-y-4">
                {decision.kind === 'pay' && (
                    <>
                        <h1 className="text-2xl font-bold">Complete your payment</h1>
                        <div className="rounded-2xl bg-primary/5 p-4 text-center">
                            <p className="text-xs text-muted-foreground">Your time is held for</p>
                            <p aria-hidden className="text-3xl font-black tabular-nums text-primary">{formatCountdown(flow.secondsLeft)}</p>
                            <p className="sr-only" role="status" aria-live="polite">{flow.announcement}</p>
                        </div>
                        {summary}
                        {flow.payNote && <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{flow.payNote}</p>}
                        <Button size="lg" className="w-full" disabled={flow.opening} onClick={() => void pay()}>
                            {flow.opening ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden /> Opening payment</> : `Pay ${formatPaise(booking.amountPaise)}`}
                        </Button>
                    </>
                )}
                {decision.kind === 'poll' && (
                    <>
                        {paidButUnsettled || booking.paymentCaptured || flow.paidHere ? (
                            <ConfirmingNotice />
                        ) : (
                            <div role="status" className="rounded-2xl bg-gray-100 p-4 text-gray-800">
                                <p className="font-bold">Checking your booking</p>
                                <p className="mt-1 text-sm">The payment window has ended. We are making sure no payment is on the way.</p>
                            </div>
                        )}
                        {summary}
                        <Button size="lg" className="w-full" disabled>Pay</Button>
                    </>
                )}
                {decision.kind === 'result' && (
                    <>
                        <PaymentStatus result={decision.result} fresh={fresh} statusLabel={info.label} doctorId={booking.doctorId} />
                        {summary}
                        <RefundLine booking={booking} />
                    </>
                )}
                {canCancel && (
                    <Button variant="outline" className="w-full" onClick={() => setCancelOpen(true)}>
                        {booking.status === 'PENDING_PAYMENT' ? 'Cancel this booking' : 'Cancel consultation'}
                    </Button>
                )}
            </div>
            <CancelDialog
                open={cancelOpen}
                bookingId={booking.consultationId}
                unpaid={booking.status === 'PENDING_PAYMENT'}
                onClose={() => setCancelOpen(false)}
                onCancelled={() => void flow.refetch()}
            />
        </main>
    );
}

export default function BookingPage() {
    return (
        <Suspense fallback={<LoadingBlock />}>
            <BookingDetail />
        </Suspense>
    );
}
