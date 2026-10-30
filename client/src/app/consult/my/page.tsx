'use client';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { useApi } from '@/hooks/useApi';
import { consult } from '@/lib/consult/api';
import { groupBookings } from '@/lib/consult/bookingFlow';
import { serverNow } from '@/lib/consult/time';
import { BookingCard } from '@/components/consult/BookingCard';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { Button } from '@/components/ui';
import type { BookingView } from '@/lib/consult/types';

function Group({ title, items, holdLive }: { title: string; items: BookingView[]; holdLive?: boolean }) {
    if (items.length === 0) return null;
    return (
        <section aria-label={title} className="mt-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">{title}</h2>
            <div className="space-y-3">
                {items.map((b) => <BookingCard key={b.consultationId} booking={b} holdLive={holdLive} />)}
            </div>
        </section>
    );
}

function MyList() {
    const { data, error, loading, refetch } = useApi(() => consult.bookings(), []);
    if (loading) return <LoadingBlock />;
    if (error) return <ErrorState message={error} onRetry={refetch} />;
    if (!data || data.length === 0) {
        return (
            <EmptyState
                title="No consultations yet"
                body="When you book a doctor, it will show up here."
                action={<Link href="/consult" className="text-sm font-bold text-primary">Find a doctor</Link>}
            />
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
        <main className="mx-auto w-full max-w-3xl px-4 py-6">
            <h1 className="text-2xl font-bold text-foreground">My consultations</h1>
            {!isInitialized && <LoadingBlock />}
            {isInitialized && !isAuthenticated && (
                <div className="mt-6 text-center">
                    <p className="text-sm text-muted-foreground">Please log in to see your consultations.</p>
                    <Button className="mt-3" onClick={openAuthDialog}>Log in</Button>
                </div>
            )}
            {isInitialized && isAuthenticated && <MyList />}
        </main>
    );
}
