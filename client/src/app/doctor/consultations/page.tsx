'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { statusInfo } from '@/lib/consult/status';
import { formatIstDateTime, formatIstTime } from '@/lib/consult/time';
import type { DoctorConsultationItem } from '@/lib/consult/types';
import { cn } from '@/lib/utils';

type Scope = 'upcoming' | 'past';
const TYPE_LABEL = { VIDEO: 'Video', AUDIO: 'Audio', CHAT: 'Chat' } as const;

function Row({ item }: { item: DoctorConsultationItem }) {
    const info = statusInfo(item.status);
    return (
        <Link
            href={`/doctor/consultations/${item.id}`}
            className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
            <div className="min-w-0">
                <p className="truncate font-bold text-foreground">{item.patientName}</p>
                <p className="text-sm font-semibold text-foreground">{formatIstDateTime(item.startsAt)} to {formatIstTime(item.endsAt)}</p>
                <p className="text-xs text-muted-foreground">{TYPE_LABEL[item.type]} consultation</p>
            </div>
            <Badge tone={info.tone}>{info.label}</Badge>
        </Link>
    );
}

export default function DoctorConsultationsPage() {
    const [scope, setScope] = useState<Scope>('upcoming');
    const { data, error, loading, refetch, setData } = useApi(() => doctorApi.consultations(scope), [scope]);
    const [more, setMore] = useState(false);
    const [moreError, setMoreError] = useState<string | null>(null);

    async function loadMore() {
        if (!data?.nextCursor) return;
        setMore(true);
        setMoreError(null);
        try {
            const next = await doctorApi.consultations(scope, data.nextCursor);
            setData({ items: [...data.items, ...next.items], nextCursor: next.nextCursor });
        } catch (e) {
            setMoreError(errorMessage(e));
        } finally {
            setMore(false);
        }
    }

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Consultations</h1>
                <p className="text-sm text-muted-foreground">All times are Indian time.</p>
            </div>
            <div role="tablist" aria-label="Which consultations" className="inline-flex rounded-xl bg-white p-1 shadow-sm">
                {(['upcoming', 'past'] as const).map((s) => (
                    <button
                        key={s}
                        role="tab"
                        type="button"
                        aria-selected={scope === s}
                        onClick={() => setScope(s)}
                        className={cn('rounded-lg px-4 py-2 text-sm font-semibold', scope === s ? 'bg-primary text-white' : 'text-gray-700 hover:text-primary')}
                    >
                        {s === 'upcoming' ? 'Upcoming' : 'Past'}
                    </button>
                ))}
            </div>
            {loading ? <LoadingBlock label="Loading consultations" />
                : error ? <ErrorState message={error} onRetry={refetch} />
                : !data || data.items.length === 0 ? (
                    <EmptyState
                        title={scope === 'upcoming' ? 'No upcoming consultations' : 'No past consultations'}
                        body={scope === 'upcoming' ? 'When a patient books you, it will show up here.' : undefined}
                    />
                ) : (
                    <>
                        <ul className="space-y-3">
                            {data.items.map((item) => <li key={item.id}><Row item={item} /></li>)}
                        </ul>
                        {moreError && <p role="alert" className="text-sm font-semibold text-destructive">{moreError}</p>}
                        {data.nextCursor && (
                            <Button variant="outline" className="w-full" disabled={more} onClick={() => void loadMore()}>
                                {more ? 'Loading...' : 'Show more'}
                            </Button>
                        )}
                    </>
                )}
        </div>
    );
}
