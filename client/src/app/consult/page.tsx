'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { consult } from '@/lib/consult/api';
import { DoctorCard } from '@/components/consult/DoctorCard';
import { DoctorFilters } from '@/components/consult/DoctorFilters';
import { activeFilterCount, directoryQuery, filtersFromParams, filtersToParams, NO_FILTERS, withFilters, type DoctorFilterState } from '@/lib/consult/doctorFilters';
import { ConcernGrid } from '@/components/consult/home/ConcernGrid';
import { ConsultHeader } from '@/components/consult/home/ConsultHeader';
import { FamilyBooking } from '@/components/consult/home/FamilyBooking';
import { GoodToKnow } from '@/components/consult/home/GoodToKnow';
import { HowItWorks } from '@/components/consult/home/HowItWorks';
import { SpecialtyChips } from '@/components/consult/SpecialtyChips';
import { EmptyState, ErrorState, Skeleton } from '@/components/consult/States';
import { Button, Notice } from '@/components/ui';
import { resolveSpecialty, specialtyLabel } from '@/lib/home/specialties';
import { Footer } from '@/components/Footer';

// useSearchParams needs a Suspense boundary so the page can still be prerendered.
export default function ConsultHomePage() {
    return (
        <Suspense fallback={<main className="w-full"><Skeleton className="h-96" /></main>}>
            <ConsultHome />
        </Suspense>
    );
}

const scrollToList = () => document.getElementById('doctors')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
    if (pages <= 1) return null;
    const btn = 'inline-flex h-11 items-center gap-1 rounded-lg border border-border-strong px-4 text-sm font-semibold text-ink hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
    return (
        <nav aria-label="Doctor list pages" className="mt-8 flex items-center justify-center gap-3">
            <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
            </button>
            <p className="min-w-24 text-center text-sm tabular-nums text-ink-muted" aria-current="page">Page {page} of {pages}</p>
            <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>
                Next <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
        </nav>
    );
}

function ConsultHome() {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    // Everything the list shows lives in the URL, so a filtered list survives reload, back and sharing.
    // ?specialty=<slug or homepage key> also comes from the homepage specialty grid and search.
    const wanted = params.get('specialty');
    const filters = useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);
    const specialties = useApi(() => consult.specialties(), []);
    const fromUrl = specialties.data ? resolveSpecialty(wanted, specialties.data) : null;
    const specialtyId = fromUrl?.id ?? null;
    // Asked for a specialty this deployment does not offer yet: say so, and show everyone instead.
    const unmatched = !!wanted && !!specialties.data && !fromUrl;
    // Wait for the specialty list before loading a specialty from the URL, so the full list never flashes first.
    const ready = !wanted || !!specialties.data || !!specialties.error;

    const navigate = useCallback((next: URLSearchParams) => {
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, [router, pathname]);
    const setFilters = useCallback((next: DoctorFilterState) => {
        navigate(filtersToParams(next, new URLSearchParams(params.toString())));
    }, [navigate, params]);
    const setSpecialtyId = (id: string | null) => {
        const next = filtersToParams(withFilters(filters, {}), new URLSearchParams(params.toString()));
        const slug = specialties.data?.find((s) => s.id === id)?.slug;
        if (slug) next.set('specialty', slug); else next.delete('specialty');
        navigate(next);
    };

    const query = directoryQuery(filters, specialtyId);
    const queryKey = ready ? JSON.stringify(query) : '';
    const doctors = useApi(() => (ready ? consult.directory(query) : Promise.resolve(null)), [queryKey]);
    // Also loading in the one render between `ready` turning true and the request starting.
    const loading = !ready || doctors.loading || (!doctors.data && !doctors.error);
    const page = doctors.data;
    const items = page?.items ?? [];
    const pages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
    const filtered = activeFilterCount(filters) > 0 || filters.q.trim() !== '';

    // The header shows one real doctor; fetched unfiltered so it stays put while the list filters.
    const featured = useApi(() => consult.doctors(), []);
    const pickConcern = (id: string) => {
        setSpecialtyId(id);
        scrollToList();
    };
    const goToPage = (p: number) => {
        setFilters({ ...filters, page: p });
        scrollToList();
    };

    return (
        <>
            <main className="w-full bg-surface pb-28 md:pb-24">
                <ConsultHeader featured={featured.data?.[0]} loading={featured.loading} />

                <div className="space-y-16 pt-12 md:pt-20 lg:pt-28">
                {specialties.data && <ConcernGrid specialties={specialties.data} onPick={pickConcern} />}

                <div id="doctors" className="container mx-auto max-w-6xl scroll-mt-24 px-4">
                    {/* Unmatched Warning */}
                    {unmatched && (
                        <Notice tone="warning" className="mb-6">
                            We don&apos;t have {specialtyLabel(wanted)} doctors on DocNow yet. Here are all our doctors; a General Physician can advise you and refer you if needed.
                        </Notice>
                    )}

                    {/* Specialty Filter */}
                    {specialties.data && specialties.data.length > 0 && (
                        <div className="mb-8">
                            <h2 className="mb-4 text-xl font-bold text-ink">Choose by specialty</h2>
                            <SpecialtyChips specialties={specialties.data} value={specialtyId} onChange={setSpecialtyId} />
                        </div>
                    )}

                    {/* Doctors Grid */}
                    <div>
                        <div className="mb-6 space-y-4">
                            <h2 className="text-xl font-bold text-ink">
                                {specialtyId ? 'Available doctors' : 'Our doctors'}
                            </h2>
                            <DoctorFilters value={filters} onChange={setFilters} languages={page?.languages ?? []} total={loading ? null : (page?.total ?? null)} loading={loading} />
                        </div>

                        {/* Online now: these Docs take instant calls, which go to the first free one, not a chosen one. */}
                        {filters.now && !loading && items.length > 0 && (
                            <Notice
                                tone="success"
                                className="mb-6"
                                title="Want to talk now?"
                                action={(
                                    <Link href="/consult/now" className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                                        <Zap className="h-4 w-4" aria-hidden /> Consult a Doc now
                                    </Link>
                                )}
                            >
                                Consult a Doc now connects you to the first free Doc who is online. You pay only after a Doc accepts. To pick a doctor, book a time on their card.
                            </Notice>
                        )}

                        <section
                            aria-label="Doctors"
                            aria-busy={loading}
                            className="grid gap-4 md:grid-cols-2 md:gap-6"
                        >
                            {loading && (
                                <>
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
                                            <div className="flex gap-4 p-5">
                                                <Skeleton className="h-20 w-20 shrink-0 rounded-xl" />
                                                <div className="min-w-0 flex-1 space-y-2">
                                                    <Skeleton className="h-5 w-2/3" />
                                                    <Skeleton className="h-4 w-1/3" />
                                                    <Skeleton className="h-4 w-full" />
                                                </div>
                                            </div>
                                            <div className="px-5 pb-4"><Skeleton className="h-9 w-full rounded-lg" /></div>
                                            <div className="flex items-center justify-between border-t border-border bg-surface-subtle px-5 py-3">
                                                <Skeleton className="h-10 w-24" />
                                                <Skeleton className="h-11 w-32 rounded-lg" />
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}
                            {!loading && doctors.error && (
                                <div className="md:col-span-2">
                                    <ErrorState message={doctors.error} onRetry={doctors.refetch} />
                                </div>
                            )}
                            {!loading && !doctors.error && page && page.total === 0 && !filtered && (
                                <div className="md:col-span-2">
                                    <EmptyState
                                        title="No doctors found"
                                        body={specialtyId ? 'No doctors are available for this specialty right now.' : 'No doctors are available right now. Please check back soon.'}
                                        action={specialtyId ? <Button variant="secondary" size="sm" onClick={() => setSpecialtyId(null)}>Show all doctors</Button> : undefined}
                                    />
                                </div>
                            )}
                            {!loading && !doctors.error && page && page.total === 0 && filtered && (
                                <div className="md:col-span-2">
                                    {filters.now && specialtyId && specialtyId !== page.onlineSpecialtyId ? (
                                        <EmptyState
                                            title="Online now is for General Physicians"
                                            body="Only General Physicians take calls straight away. Book a time with this specialty, or see who is online across all doctors."
                                            action={<Button variant="secondary" size="sm" onClick={() => setSpecialtyId(null)}>Show all specialties</Button>}
                                        />
                                    ) : filters.now ? (
                                        <EmptyState
                                            title="No Doc is online right now"
                                            body="Book a time with any doctor instead, or check again in a few minutes."
                                            action={<Button variant="secondary" size="sm" onClick={() => setFilters(withFilters(filters, { now: false }))}>Show all doctors</Button>}
                                        />
                                    ) : (
                                        <EmptyState
                                            title="No doctors match"
                                            body={filters.q.trim() ? `No doctor's name matches "${filters.q.trim()}". Check the spelling, or remove a filter.` : 'Try removing a filter to see more doctors.'}
                                            action={<Button variant="secondary" size="sm" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
                                        />
                                    )}
                                </div>
                            )}
                            {/* An old link to a page past the end (the list got shorter). */}
                            {!loading && !doctors.error && page && page.total > 0 && items.length === 0 && (
                                <div className="md:col-span-2">
                                    <EmptyState
                                        title="This page is empty"
                                        body="The list has changed since this link was made."
                                        action={<Button variant="secondary" size="sm" onClick={() => goToPage(1)}>Go to the first page</Button>}
                                    />
                                </div>
                            )}
                            {!loading && !doctors.error && items.map((d) => <DoctorCard key={d.id} doctor={d} />)}
                        </section>
                        {!loading && !doctors.error && items.length > 0 && <Pager page={filters.page} pages={pages} onPage={goToPage} />}
                    </div>
                </div>

                <HowItWorks />
                <FamilyBooking />
                <GoodToKnow />
                </div>
            </main>
            <Footer />
        </>
    );
}
