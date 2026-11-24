'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { formatIstDay } from '@/lib/consult/time';
import type { DoctorPatientSummary } from '@/lib/consult/types';

/** People this doctor has seen or is booked to see, newest visit first, with a name search. */
export default function DoctorPatientsPage() {
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [items, setItems] = useState<DoctorPatientSummary[] | null>(null);
    const [nextPage, setNextPage] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [more, setMore] = useState(false);
    const [attempt, setAttempt] = useState(0);
    // Bumped for every new list (search, clear, retry): a late "Show more" for an older list is dropped.
    const generation = useRef(0);

    /** Starts the list again for `next` (also when it equals the current search, e.g. a repeat submit). */
    function restart(next: string) {
        generation.current += 1;
        setItems(null);
        setNextPage(null);
        setError(null);
        setSearch(next);
        setAttempt((n) => n + 1);
    }

    useEffect(() => {
        let alive = true;
        doctorApi.patients(search, 1)
            .then((r) => { if (alive) { setItems(r.items); setNextPage(r.nextPage); setError(null); } })
            .catch((e) => { if (alive) setError(errorMessage(e)); });
        return () => { alive = false; };
    }, [search, attempt]);

    async function loadMore() {
        if (!nextPage || !items) return;
        const mine = generation.current;
        setMore(true);
        try {
            const r = await doctorApi.patients(search, nextPage);
            if (mine !== generation.current) return;
            setItems((cur) => [...(cur ?? []), ...r.items]);
            setNextPage(r.nextPage);
        } catch (e) {
            if (mine === generation.current) setError(errorMessage(e));
        } finally {
            setMore(false);
        }
    }

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Patients</h1>
                <p className="text-sm text-muted-foreground">People you have seen or are booked to see. Their full health record opens from a booking they shared it for.</p>
            </div>
            <form
                role="search"
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); restart(query.trim()); }}>
                <label className="relative min-w-0 flex-1">
                    <span className="sr-only">Search patients by name</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <input
                        id="patient-search"
                        value={query}
                        maxLength={80}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search by name"
                        className="h-10 w-full rounded-xl border border-border bg-input pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                    {query && (
                        <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); restart(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground">
                            <X className="h-4 w-4" aria-hidden />
                        </button>
                    )}
                </label>
                <Button type="submit">Search</Button>
            </form>
            {error && !items ? <ErrorState message={error} onRetry={() => restart(search)} />
                : !items ? <LoadingBlock label="Loading patients" />
                : items.length === 0 ? <EmptyState title={search ? 'No patients with that name' : 'No patients yet'} body={search ? 'Try part of the name.' : 'People appear here once they book you.'} />
                : (
                    <ul className="space-y-2">
                        {items.map((p) => (
                            <li key={p.id}>
                                <Link href={`/doctor/patients/${p.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                    <div className="min-w-0">
                                        <p className="truncate font-bold text-foreground">{p.name}</p>
                                        <p className="text-sm text-muted-foreground">{p.age} years · {p.gender}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {p.visits} {p.visits === 1 ? 'booking' : 'bookings'} · {new Date(p.lastVisitAt).getTime() > Date.now() ? 'next' : 'last'} {formatIstDay(p.lastVisitAt)}
                                        </p>
                                    </div>
                                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            {error && items && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
            {nextPage && items && <Button variant="outline" className="w-full" loading={more} onClick={() => void loadMore()}>Show more</Button>}
        </div>
    );
}
