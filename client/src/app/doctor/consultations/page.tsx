'use client';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
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
const filterLabel = 'mb-1 block text-xs font-semibold text-muted-foreground';
const filterField = 'h-10 w-full rounded-xl border border-border bg-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring';

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
                <p className="text-xs text-muted-foreground">{item.isInstant ? `Instant ${TYPE_LABEL[item.type].toLowerCase()}` : TYPE_LABEL[item.type]} consultation</p>
            </div>
            <Badge tone={info.tone}>{info.label}</Badge>
        </Link>
    );
}

export default function DoctorConsultationsPage() {
    const [scope, setScope] = useState<Scope>('upcoming');
    const [typed, setTyped] = useState('');
    const [q, setQ] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const filters = { q, from, to };
    const filtered = !!(q || from || to);
    const badRange = !!from && !!to && from > to;
    // Searches once typing pauses, not on every key.
    useEffect(() => {
        const t = setTimeout(() => setQ(typed.trim()), 300);
        return () => clearTimeout(t);
    }, [typed]);
    const { data, error, loading, refetch, setData } = useApi(
        () => (badRange ? Promise.resolve({ items: [], nextCursor: null }) : doctorApi.consultations(scope, undefined, filters)),
        [scope, q, from, to],
    );
    const [more, setMore] = useState(false);
    const [moreError, setMoreError] = useState<string | null>(null);
    // The list a "Show more" belongs to; a page that arrives after the filters changed is dropped.
    const listKey = `${scope}|${q}|${from}|${to}`;
    const currentKey = useRef(listKey);
    useEffect(() => {
        currentKey.current = listKey;
    }, [listKey]);

    async function loadMore() {
        if (!data?.nextCursor) return;
        const key = listKey;
        setMore(true);
        setMoreError(null);
        try {
            const next = await doctorApi.consultations(scope, data.nextCursor, filters);
            if (currentKey.current !== key) return;
            setData({ items: [...data.items, ...next.items], nextCursor: next.nextCursor });
        } catch (e) {
            if (currentKey.current === key) setMoreError(errorMessage(e));
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
            <div className="grid gap-2 rounded-2xl bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <div>
                    <label htmlFor="history-q" className={filterLabel}>Patient name</label>
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <input id="history-q" type="search" value={typed} maxLength={80} placeholder="Search by name"
                            onChange={(e) => setTyped(e.target.value)} className={`${filterField} pl-9`} />
                    </div>
                </div>
                <div>
                    <label htmlFor="history-from" className={filterLabel}>From</label>
                    <input id="history-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={filterField} />
                </div>
                <div>
                    <label htmlFor="history-to" className={filterLabel}>To</label>
                    <input id="history-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={filterField} />
                </div>
                {filtered || typed ? (
                    <Button variant="ghost" size="sm" onClick={() => { setTyped(''); setQ(''); setFrom(''); setTo(''); }}>
                        <X className="h-4 w-4" aria-hidden /> Clear
                    </Button>
                ) : <span className="hidden sm:block" />}
            </div>
            {badRange && <p role="alert" className="text-sm font-semibold text-destructive">The From date must be on or before the To date.</p>}
            {loading ? <LoadingBlock label="Loading consultations" />
                : error ? <ErrorState message={error} onRetry={refetch} />
                : !data || data.items.length === 0 ? (
                    filtered ? <EmptyState title="No consultations match" body="Try another name or dates." /> : (
                        <EmptyState
                            title={scope === 'upcoming' ? 'No upcoming consultations' : 'No past consultations'}
                            body={scope === 'upcoming' ? 'When a patient books you, it will show up here.' : undefined}
                        />
                    )
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
