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
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { Button } from '@/components/ui';
import { Footer } from '@/components/Footer';
import type { BookingView } from '@/lib/consult/types';

function Group({ title, items, holdLive }: { title: string; items: BookingView[]; holdLive?: boolean }) {
    if (items.length === 0) return null;
    return (
        <section aria-label={title} className="mt-8">
            <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-black text-foreground md:text-xl">{title}</h2>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
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
                        <div className="h-6 w-24 bg-gray-200 rounded" />
                        <div className="h-6 w-6 bg-gray-200 rounded-full" />
                    </div>
                    <div className="space-y-3">
                        {[1, 2].map((i) => (
                            <div key={i} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="h-5 w-40 bg-gray-200 rounded" />
                                    <div className="h-6 w-24 bg-gray-200 rounded-full" />
                                </div>
                                <div className="mb-2 h-4 w-32 bg-gray-200 rounded" />
                                <div className="mb-2 h-4 w-48 bg-gray-200 rounded" />
                                <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                                    <div className="h-6 w-20 bg-gray-200 rounded" />
                                    <div className="h-9 w-28 bg-gray-200 rounded-xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Past Section Skeleton */}
                <section>
                    <div className="mb-4 flex items-center gap-3">
                        <div className="h-6 w-16 bg-gray-200 rounded" />
                        <div className="h-6 w-6 bg-gray-200 rounded-full" />
                    </div>
                    <div className="space-y-3">
                        {[1].map((i) => (
                            <div key={i} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="h-5 w-40 bg-gray-200 rounded" />
                                    <div className="h-6 w-24 bg-gray-200 rounded-full" />
                                </div>
                                <div className="mb-2 h-4 w-32 bg-gray-200 rounded" />
                                <div className="mb-2 h-4 w-48 bg-gray-200 rounded" />
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
                <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-purple-100">
                    <Stethoscope className="h-10 w-10 text-primary" aria-hidden />
                </div>
                <h2 className="mb-3 text-2xl font-black text-foreground">No consultations yet</h2>
                <p className="mb-6 text-muted-foreground">When you book a doctor, it will show up here.</p>
                <Link
                    href="/consult"
                    className="inline-flex rounded-2xl bg-primary px-8 py-3 font-extrabold text-white shadow-lg hover:bg-primary/90"
                >
                    Find a Doctor
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
            <main className="w-full bg-white pb-16 md:pb-24">
                {/* Mini Hero */}
                <section
                    className="pb-12 pt-12 md:pb-16 md:pt-16"
                    style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
                >
                    <div className="container mx-auto max-w-6xl px-4">
                        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
                            <div className="text-center md:text-left">
                                <h1 className="text-3xl font-black text-white md:text-4xl">My Consultations</h1>
                                <p className="mt-2 text-base font-medium text-white/80 md:text-lg">
                                    Track your appointments and access prescriptions
                                </p>
                            </div>
                            <Link
                                href="/consult"
                                className="shrink-0 rounded-2xl bg-white px-6 py-3 font-extrabold text-primary shadow-lg hover:bg-white/90"
                            >
                                Book New Consultation
                            </Link>
                        </div>
                    </div>
                </section>

                <div className="container mx-auto max-w-6xl px-4 py-8">
                    {!isInitialized && <LoadingBlock />}
                    {isInitialized && !isAuthenticated && (
                        <div className="mt-12 text-center">
                            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-purple-100">
                                <Stethoscope className="h-10 w-10 text-primary" aria-hidden />
                            </div>
                            <h2 className="mb-3 text-2xl font-black text-foreground">Log in to continue</h2>
                            <p className="mb-6 text-muted-foreground">Please log in to see your consultations.</p>
                            <Button className="bg-primary px-8 py-3 font-extrabold" onClick={openAuthDialog}>
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
