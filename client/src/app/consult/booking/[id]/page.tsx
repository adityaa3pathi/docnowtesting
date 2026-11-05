'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Loader2, ChevronLeft, Clock } from 'lucide-react';
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
import { Button, Card } from '@/components/ui';
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
    if (flow.loading && !booking) {
        return (
            <>
                <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16 animate-pulse">
                    <div className="mb-6 flex items-center gap-2">
                        <div className="h-4 w-4 bg-gray-200 rounded" />
                        <div className="h-4 w-32 bg-gray-200 rounded" />
                    </div>
                    <div className="space-y-6">
                        {/* Status Card Skeleton */}
                        <div className="text-center">
                            <div className="mx-auto h-10 w-64 bg-gray-200 rounded" />
                        </div>

                        {/* Main Card Skeleton */}
                        <Card className="p-8 shadow-2xl">
                            <div className="mb-6 mx-auto h-8 w-48 bg-gray-200 rounded-full" />
                            <div className="mx-auto h-20 w-48 bg-gray-200 rounded" />
                            <div className="mt-4 mx-auto h-4 w-56 bg-gray-200 rounded" />
                        </Card>

                        {/* Booking Summary Skeleton */}
                        <Card className="p-6 shadow-md">
                            <div className="space-y-4">
                                <div className="h-6 w-3/4 bg-gray-200 rounded" />
                                <div className="h-4 w-1/2 bg-gray-200 rounded" />
                                <div className="h-4 w-2/3 bg-gray-200 rounded" />
                                <div className="flex justify-between border-t pt-4">
                                    <div className="h-5 w-20 bg-gray-200 rounded" />
                                    <div className="h-5 w-24 bg-gray-200 rounded" />
                                </div>
                            </div>
                        </Card>

                        {/* Action Button Skeleton */}
                        <div className="h-14 w-full bg-gray-200 rounded-2xl" />
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
        <>
            <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16">
                <Link href="/consult/my" className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80">
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    My consultations
                </Link>
                <div className="mt-6 space-y-6">
                    {decision.kind === 'pay' && (
                        <>
                            <div className="text-center">
                                <h1 className="text-3xl font-black text-foreground md:text-4xl">Complete Your Payment</h1>
                            </div>

                            {/* Countdown Timer Card */}
                            <Card
                                className="overflow-hidden border-0 p-8 text-center shadow-2xl"
                                style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
                            >
                                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 backdrop-blur-sm">
                                    <Clock className="h-4 w-4 text-white" aria-hidden />
                                    <span className="text-xs font-bold uppercase tracking-wider text-white">Time Remaining</span>
                                </div>
                                <p aria-hidden className="text-6xl font-black tabular-nums text-white md:text-7xl">
                                    {formatCountdown(flow.secondsLeft)}
                                </p>
                                <p className="sr-only" role="status" aria-live="polite">{flow.announcement}</p>
                                <p className="mt-3 text-sm font-medium text-white/80">Your slot is held while you complete payment</p>
                            </Card>

                            <Card className="shadow-md">{summary}</Card>

                            {flow.payNote && (
                                <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 shadow-sm">
                                    <p className="text-sm font-semibold text-amber-800">{flow.payNote}</p>
                                </div>
                            )}

                            <Button
                                size="lg"
                                className="w-full bg-primary py-6 text-lg font-extrabold shadow-lg"
                                disabled={flow.opening}
                                onClick={() => void pay()}
                            >
                                {flow.opening ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
                                        Opening payment
                                    </>
                                ) : (
                                    `Pay ${formatPaise(booking.amountPaise)}`
                                )}
                            </Button>
                        </>
                    )}

                    {decision.kind === 'poll' && (
                        <>
                            {paidButUnsettled || booking.paymentCaptured || flow.paidHere ? (
                                <ConfirmingNotice />
                            ) : (
                                <Card className="border-blue-200 bg-blue-50 p-6 shadow-sm">
                                    <p className="font-bold text-blue-900">Checking your booking</p>
                                    <p className="mt-2 text-sm text-blue-800">
                                        The payment window has ended. We are making sure no payment is on the way.
                                    </p>
                                </Card>
                            )}
                            <Card className="shadow-md">{summary}</Card>
                            <Button size="lg" className="w-full" disabled>Pay</Button>
                        </>
                    )}

                    {decision.kind === 'result' && (
                        <>
                            <PaymentStatus result={decision.result} fresh={fresh} statusLabel={info.label} doctorId={booking.doctorId} />
                            <Card className="shadow-md">{summary}</Card>
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
                                <Card className="flex items-center justify-between gap-3 bg-gray-50 p-4">
                                    <p className="text-sm text-gray-700">Your prescription will show here once the doctor issues it.</p>
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
