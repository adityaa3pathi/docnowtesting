'use client';
import Link from 'next/link';
import { Stethoscope } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { useApi } from '@/hooks/useApi';
import { consult } from '@/lib/consult/api';
import { groupBookings } from '@/lib/consult/bookingFlow';
import { serverNow } from '@/lib/consult/time';
import { BookingCard } from '@/components/consult/BookingCard';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { Button } from '@/components/ui';
import { Footer } from '@/components/Footer';
import type { BookingView } from '@/lib/consult/types';

function Group({ title, items, holdLive }: { title: string; items: BookingView[]; holdLive?: boolean }) {
    if (items.length === 0) return null;
    return (
        <section aria-label={title} className="mt-8">
            <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-bold text-ink md:text-xl">{title}</h2>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                    {items.length}
                </span>
            </div>
            <div className="space-y-3">
                {items.map((b) => <BookingCard key={b.consultationId} booking={b} holdLive={holdLive} />)}
            </div>
        </section>
    );
}

function MyList() {
    const { data, error, loading, refetch } = useApi(() => consult.bookings(), []);
    if (loading) {
        return (
            <div className="mt-8 space-y-8 animate-pulse">
                {/* Upcoming Section Skeleton */}
                <section>
                    <div className="mb-4 flex items-center gap-3">
                        <div className="h-6 w-24 bg-surface-muted rounded" />
                        <div className="h-6 w-6 bg-surface-muted rounded-full" />
                    </div>
                    <div className="space-y-3">
                        {[1, 2].map((i) => (
                            <div key={i} className="rounded-xl border border-border bg-surface p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="h-5 w-40 bg-surface-muted rounded" />
                                    <div className="h-6 w-24 bg-surface-muted rounded-full" />
                                </div>
                                <div className="mb-2 h-4 w-32 bg-surface-muted rounded" />
                                <div className="mb-2 h-4 w-48 bg-surface-muted rounded" />
                                <div className="flex items-center justify-between border-t border-border pt-3">
                                    <div className="h-6 w-20 bg-surface-muted rounded" />
                                    <div className="h-9 w-28 bg-surface-muted rounded-xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Past Section Skeleton */}
                <section>
                    <div className="mb-4 flex items-center gap-3">
                        <div className="h-6 w-16 bg-surface-muted rounded" />
                        <div className="h-6 w-6 bg-surface-muted rounded-full" />
                    </div>
                    <div className="space-y-3">
                        {[1].map((i) => (
                            <div key={i} className="rounded-xl border border-border bg-surface p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="h-5 w-40 bg-surface-muted rounded" />
                                    <div className="h-6 w-24 bg-surface-muted rounded-full" />
                                </div>
                                <div className="mb-2 h-4 w-32 bg-surface-muted rounded" />
                                <div className="mb-2 h-4 w-48 bg-surface-muted rounded" />
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        );
    }
    if (error) return <ErrorState message={error} onRetry={refetch} />;
    if (!data || data.length === 0) {
        return (
            <div className="mt-12 text-center">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft">
                    <Stethoscope className="h-6 w-6 text-primary" aria-hidden />
                </div>
                <h2 className="mb-2 text-xl font-bold text-ink">No consultations yet</h2>
                <p className="mb-6 text-ink-muted">When you book a doctor, it will show up here.</p>
                <Link
                    href="/consult"
                    className="inline-flex h-11 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted"
                >
                    Find a doctor
                </Link>
            </div>
        );
    }
    const groups = groupBookings(data, serverNow());
    return (
        <>
            <Group title="Upcoming" items={groups.upcoming} />
            <Group title="Waiting for payment" items={groups.unpaid} holdLive />
            <Group title="Past" items={groups.past} />
        </>
    );
}

export default function MyConsultationsPage() {
    const { isAuthenticated, isInitialized } = useAuth();
    const { openAuthDialog } = useAuthGate();

    return (
        <>
            <main className="w-full bg-surface pb-16 md:pb-24">
                <section className="border-b border-border bg-surface-subtle">
                    <div className="container mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 md:flex-row md:items-end md:justify-between md:py-10">
                        <div>
                            <h1 className="text-3xl font-bold text-ink">My consultations</h1>
                            <p className="mt-1 text-base text-ink-muted">Your appointments and prescriptions.</p>
                        </div>
                        <Link
                            href="/consult"
                            className="inline-flex h-11 w-fit items-center rounded-lg bg-primary px-4 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                            Book a consultation
                        </Link>
                    </div>
                </section>

                <div className="container mx-auto max-w-6xl px-4 py-8">
                    {!isInitialized && <LoadingBlock />}
                    {isInitialized && !isAuthenticated && (
                        <div className="mt-12 text-center">
                            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft">
                                <Stethoscope className="h-6 w-6 text-primary" aria-hidden />
                            </div>
                            <h2 className="mb-3 text-2xl font-bold text-ink">Log in to continue</h2>
                            <p className="mb-6 text-ink-muted">Please log in to see your consultations.</p>
                            <Button onClick={openAuthDialog}>
                                Log in
                            </Button>
                        </div>
                    )}
                    {isInitialized && isAuthenticated && <MyList />}
                </div>
            </main>
            <Footer />
        </>
    );
}
