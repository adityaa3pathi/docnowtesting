'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ChevronLeft, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { useBookingFlow } from '@/hooks/useBookingFlow';
import { consult } from '@/lib/consult/api';
import { formatPaise } from '@/lib/consult/format';
import { formatCountdown } from '@/lib/consult/bookingFlow';
import { statusInfo } from '@/lib/consult/status';
import { BookingSummary } from '@/components/consult/BookingSummary';
import { CancelDialog } from '@/components/consult/CancelDialog';
import { JoinPanel } from '@/components/consult/JoinPanel';
import { PatientPrescription } from '@/components/consult/PatientPrescription';
import { ConfirmingNotice, PaymentStatus } from '@/components/consult/PaymentStatus';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { Button, Card, Notice } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Footer } from '@/components/Footer';
import type { BookingView } from '@/lib/consult/types';

const REFUND_TEXT = {
    PENDING: 'Refund on its way',
    PROCESSED: 'Refund sent to your original payment method',
    FAILED: 'Refund needs a manual step. Our team has been told.',
} as const;

function RefundLine({ booking }: { booking: BookingView }) {
    if (booking.refundPaise <= 0) return null;
    return (
        <p className="rounded-xl bg-primary-soft px-4 py-3 text-sm font-semibold">
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
                <h1 className="text-xl font-semibold">Log in to see this booking</h1>
                <p className="mt-2 text-sm text-ink-muted">If you paid, your booking is safe. Log in to see where it stands.</p>
                <Button className="mt-4" onClick={openAuthDialog}>Log in</Button>
            </main>
        );
    }
    if (flow.loading && !booking) {
        return (
            <>
                <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16 animate-pulse">
                    <div className="mb-6 flex items-center gap-2">
                        <div className="h-4 w-4 bg-surface-muted rounded" />
                        <div className="h-4 w-32 bg-surface-muted rounded" />
                    </div>
                    <div className="space-y-6">
                        {/* Status Card Skeleton */}
                        <div className="text-center">
                            <div className="mx-auto h-10 w-64 bg-surface-muted rounded" />
                        </div>

                        {/* Main Card Skeleton */}
                        <Card className="p-8">
                            <div className="mb-6 mx-auto h-8 w-48 bg-surface-muted rounded-full" />
                            <div className="mx-auto h-20 w-48 bg-surface-muted rounded" />
                            <div className="mt-4 mx-auto h-4 w-56 bg-surface-muted rounded" />
                        </Card>

                        {/* Booking Summary Skeleton */}
                        <Card className="p-6">
                            <div className="space-y-4">
                                <div className="h-6 w-3/4 bg-surface-muted rounded" />
                                <div className="h-4 w-1/2 bg-surface-muted rounded" />
                                <div className="h-4 w-2/3 bg-surface-muted rounded" />
                                <div className="flex justify-between border-t pt-4">
                                    <div className="h-5 w-20 bg-surface-muted rounded" />
                                    <div className="h-5 w-24 bg-surface-muted rounded" />
                                </div>
                            </div>
                        </Card>

                        {/* Action Button Skeleton */}
                        <div className="h-14 w-full bg-surface-muted rounded-xl" />
                    </div>
                </main>
                <Footer />
            </>
        );
    }
    if (!booking || !decision) {
        return (
            <main className="mx-auto max-w-md px-4 py-10">
                <ErrorState message={flow.error?.message ?? 'We could not load this booking.'} onRetry={() => void flow.refetch()} />
                <p className="mt-4 text-center text-sm"><Link href="/consult/my" className="font-semibold text-primary">My consultations</Link></p>
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
        <>
            <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16">
                <Link href="/consult/my" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    My consultations
                </Link>
                <div className="mt-6 space-y-6">
                    {decision.kind === 'pay' && (
                        <>
                            <h1 className="text-2xl font-semibold text-ink md:text-3xl">Complete your payment</h1>

                            {/* The hold countdown: clear and calm; it turns amber only in the last minutes. */}
                            <Card className={cn('flex items-center gap-4 p-5', flow.secondsLeft <= 120 && 'border-warning bg-warning-soft')}>
                                <Clock className={cn('h-6 w-6 shrink-0', flow.secondsLeft <= 120 ? 'text-warning' : 'text-primary')} aria-hidden />
                                <div className="flex-1">
                                    <p className="text-sm text-ink-muted">Your slot is held while you pay</p>
                                    <p aria-hidden className="text-3xl font-semibold tabular-nums text-ink">{formatCountdown(flow.secondsLeft)}</p>
                                </div>
                                <p className="sr-only" role="status" aria-live="polite">{flow.announcement}</p>
                            </Card>

                            <Card>{summary}</Card>

                            {flow.payNote && <Notice tone="warning">{flow.payNote}</Notice>}

                            <Button size="lg" className="w-full" loading={flow.opening} onClick={() => void pay()}>
                                {flow.opening ? 'Opening payment' : `Pay ${formatPaise(booking.amountPaise)}`}
                            </Button>
                        </>
                    )}

                    {decision.kind === 'poll' && (
                        <>
                            {paidButUnsettled || booking.paymentCaptured || flow.paidHere ? (
                                <ConfirmingNotice />
                            ) : (
                                <Notice tone="info" title="Checking your booking">
                                    The payment window has ended. We are making sure no payment is on the way.
                                </Notice>
                            )}
                            <Card>{summary}</Card>
                            <Button size="lg" className="w-full" disabled>Pay</Button>
                        </>
                    )}

                    {decision.kind === 'result' && (
                        <>
                            <PaymentStatus result={decision.result} fresh={fresh} statusLabel={info.label} doctorId={booking.doctorId} />
                            <Card>{summary}</Card>
                            <RefundLine booking={booking} />
                            <JoinPanel
                                status={booking.status}
                                type={booking.type}
                                startsAt={booking.startsAt}
                                endsAt={booking.endsAt}
                                otherParty="doctor"
                                join={() => consult.join(booking.consultationId, true)}
                                consentDoctorName={booking.doctorName}
                                onChange={() => void flow.refetch()}
                            />
                            {booking.hasPrescription ? (
                                <PatientPrescription bookingId={booking.consultationId} />
                            ) : (booking.status === 'IN_PROGRESS' || booking.status === 'COMPLETED') && (
                                <Card className="flex items-center justify-between gap-3 bg-surface-subtle p-4">
                                    <p className="text-sm text-ink">Your prescription will show here once the doctor issues it.</p>
                                    <Button variant="outline" size="sm" onClick={() => void flow.refetch()}>Check again</Button>
                                </Card>
                            )}
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
            <Footer />
        </>
    );
}

export default function BookingPage() {
    return (
        <Suspense fallback={<LoadingBlock />}>
            <BookingDetail />
        </Suspense>
    );
}
