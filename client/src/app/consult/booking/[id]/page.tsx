'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CalendarClock, ChevronLeft, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { useBookingFlow } from '@/hooks/useBookingFlow';
import { consult } from '@/lib/consult/api';
import { formatPaise } from '@/lib/consult/format';
import { bookedPriceLines, refundDestination } from '@/lib/consult/price';
import { formatCountdown } from '@/lib/consult/bookingFlow';
import { changeTimeRules } from '@/lib/consult/changeTime';
import { formatIstDateTime } from '@/lib/consult/time';
import { statusInfo } from '@/lib/consult/status';
import { BookingSummary } from '@/components/consult/BookingSummary';
import { CancelDialog } from '@/components/consult/CancelDialog';
import { ChangeTimeDialog } from '@/components/consult/ChangeTimeDialog';
import { ChatPanel } from '@/components/consult/ChatPanel';
import { JoinPanel } from '@/components/consult/JoinPanel';
import { PatientPrescription } from '@/components/consult/PatientPrescription';
import { RecordSharingCard } from '@/components/consult/RecordSharingCard';
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
    // Part of it went back to the wallet: say where each part goes, not "original payment method".
    if ((booking.walletRefundPaise ?? 0) > 0) {
        const done = booking.refundStatus === 'PROCESSED';
        return (
            <p className="rounded-xl bg-primary-soft px-4 py-3 text-sm font-semibold">
                Refund {done ? 'sent' : 'on its way'}: {refundDestination(booking.refundPaise, booking.walletRefundPaise, formatPaise)}.
                {booking.refundStatus === 'FAILED' && ' Part of it needs a manual step. Our team has been told.'}
            </p>
        );
    }
    return (
        <p className="rounded-xl bg-primary-soft px-4 py-3 text-sm font-semibold">
            {formatPaise(booking.refundPaise)}: {booking.refundStatus ? REFUND_TEXT[booking.refundStatus] : 'Refund being prepared'}
        </p>
    );
}

// Statuses where a chat can exist: from the first join on (the transcript stays after the visit).
const CHAT_STATUSES = ['WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR', 'REFUNDED'];

function BookingDetail() {
    const { id } = useParams<{ id: string }>();
    const params = useSearchParams();
    const autoPay = params.get('pay') === '1';
    // From My consultations: open the change-time box straight away.
    const autoChange = params.get('change') === '1';
    const { isAuthenticated, isInitialized } = useAuth();
    const { openAuthDialog } = useAuthGate();
    const flow = useBookingFlow(id, isInitialized && isAuthenticated);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [changeOpen, setChangeOpen] = useState(false);
    const [movedTo, setMovedTo] = useState<string | null>(null);
    const [inCall, setInCall] = useState(false);
    const chat = useMemo(() => consult.chat(id), [id]);
    const autoOpened = useRef(false);
    const autoChangeOpened = useRef(false);
    const { booking, decision, pay } = flow;

    // Opens the payment window once, right after the booking is created.
    useEffect(() => {
        if (autoPay && !autoOpened.current && decision?.kind === 'pay') {
            autoOpened.current = true;
            void pay();
        }
    }, [autoPay, decision?.kind, pay]);

    useEffect(() => {
        if (autoChange && !autoChangeOpened.current && booking?.selfReschedule?.allowed) {
            autoChangeOpened.current = true;
            setChangeOpen(true);
        }
    }, [autoChange, booking?.selfReschedule?.allowed]);

    if (!isInitialized) return <LoadingBlock />;
    if (!isAuthenticated) {
        return (
            <main className="mx-auto max-w-md px-4 py-10 text-center">
                <h1 className="text-xl font-bold">Log in to see this booking</h1>
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
            {...bookedPriceLines(booking, formatPaise)}
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
                            <h1 className="text-2xl font-bold text-ink md:text-3xl">Complete your payment</h1>

                            {/* The hold countdown: clear and calm; it turns amber only in the last minutes. */}
                            <Card className={cn('flex items-center gap-4 p-5', flow.secondsLeft <= 120 && 'border-warning bg-warning-soft')}>
                                <Clock className={cn('h-6 w-6 shrink-0', flow.secondsLeft <= 120 ? 'text-warning' : 'text-primary')} aria-hidden />
                                <div className="flex-1">
                                    <p className="text-sm text-ink-muted">Your slot is held while you pay</p>
                                    <p aria-hidden className="text-3xl font-bold tabular-nums text-ink">{formatCountdown(flow.secondsLeft)}</p>
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
                            {movedTo && <Notice tone="success">Moved to {formatIstDateTime(movedTo)}. {booking.doctorName} has the new time.</Notice>}
                            {/* An instant consult has no time to move. */}
                            {booking.status === 'CONFIRMED' && booking.selfReschedule && !booking.isInstant && (
                                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                                    <div className="min-w-0 flex-1">
                                        <p className="flex items-center gap-2 text-sm font-semibold text-ink"><CalendarClock className="h-4 w-4 text-primary" aria-hidden /> Need another time?</p>
                                        <p className="text-sm text-ink-muted">
                                            {booking.selfReschedule.allowed ? changeTimeRules(booking.selfReschedule) : booking.selfReschedule.reason}
                                        </p>
                                    </div>
                                    {booking.selfReschedule.allowed && (
                                        <Button variant="outline" size="sm" onClick={() => setChangeOpen(true)}>Change time</Button>
                                    )}
                                </Card>
                            )}
                            {booking.recordSharing && (
                                <RecordSharingCard
                                    key={`${booking.consultationId}-${booking.recordSharing.shared}-${booking.status}`}
                                    bookingId={booking.consultationId}
                                    doctorName={booking.doctorName}
                                    patientName={booking.patientName}
                                    sharing={booking.recordSharing}
                                />
                            )}
                            <JoinPanel
                                status={booking.status}
                                type={booking.type}
                                startsAt={booking.startsAt}
                                endsAt={booking.endsAt}
                                otherParty="doctor"
                                join={() => consult.join(booking.consultationId, !booking.consentOnFile)}
                                consentDoctorName={booking.consentOnFile ? undefined : booking.doctorName}
                                onChange={() => void flow.refetch()}
                                onCallChange={setInCall}
                                chat={booking.familyAccess === 'pending' ? undefined : chat}
                            />
                            {!inCall && booking.familyAccess !== 'pending' && CHAT_STATUSES.includes(booking.status) && (
                                <ChatPanel api={chat} live={booking.status === 'WAITING' || booking.status === 'IN_PROGRESS'} hideWhenEmpty />
                            )}
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
                {booking.selfReschedule && (
                    <ChangeTimeDialog
                        open={changeOpen}
                        booking={{ ...booking, selfReschedule: booking.selfReschedule }}
                        onClose={() => setChangeOpen(false)}
                        onStale={() => {
                            setChangeOpen(false);
                            void flow.refetch();
                        }}
                        onChanged={(b) => {
                            setChangeOpen(false);
                            setMovedTo(b.startsAt);
                            void flow.refetch();
                        }}
                    />
                )}
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
