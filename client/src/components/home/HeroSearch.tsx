'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { FlaskConical, Loader2, Search, Stethoscope } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { useGlobalSearch, type SearchResultItem } from '@/hooks/useGlobalSearch';
import { searchDoctors } from '@/lib/consult/doctorSearch';
import { formatRupees } from '@/lib/consult/format';
import { generateProductSlug } from '@/lib/mapProductDetails';
import { useDoctorDirectory } from './useDoctorDirectory';

const productHref = (item: SearchResultItem) =>
    `/${item.type === 'PROFILE' ? 'profiles' : item.type === 'PACKAGE' ? 'packages' : 'tests'}/${generateProductSlug(item.name, item.partnerCode)}`;

/**
 * One search box for both halves of DocNow: doctors (by name, specialty or symptom, matched on the
 * already-loaded doctor list) and lab tests & packages (from the catalog).
 */
export function HeroSearch() {
    const router = useRouter();
    const listId = useId();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLFormElement>(null);
    const debounced = useDebounce(query, 250);
    const tests = useGlobalSearch(debounced);
    const directory = useDoctorDirectory();
    const doctors = query.trim() ? searchDoctors(directory.data ?? [], query).slice(0, 3) : [];
    const q = query.trim();

    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!q) return;
        setOpen(false);
        // Only doctors match (e.g. "acne", a doctor's name): show that specialty's doctors.
        if (doctors.length > 0 && tests.results.length === 0 && !tests.isLoading) {
            router.push(`/consult?specialty=${encodeURIComponent(doctors[0].specialty.slug)}`);
            return;
        }
        router.push(`/search?q=${encodeURIComponent(q)}`);
    }

    const showPanel = open && q.length > 0;
    return (
        <form ref={box} role="search" onSubmit={submit} className="relative w-full">
            <label htmlFor={`${listId}-input`} className="sr-only">Search doctors, specialties, symptoms or lab tests</label>
            <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-2 shadow-[0_12px_40px_rgba(20,0,60,0.35)] ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-white/70">
                <Search className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <input
                    id={`${listId}-input`}
                    data-testid="hero-search-input"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
                    placeholder="Search doctors, symptoms or lab tests"
                    autoComplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showPanel}
                    aria-controls={`${listId}-results`}
                    className="min-h-11 flex-1 bg-transparent text-base text-gray-900 placeholder:text-gray-400 focus:outline-none"
                />
                <button type="submit" className="hidden shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary/90 sm:block">
                    Search
                </button>
            </div>

            {showPanel && (
                <div id={`${listId}-results`} data-testid="hero-search-results" className="absolute inset-x-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl bg-white p-2 text-left shadow-2xl ring-1 ring-black/5">
                    {doctors.length > 0 && (
                        <div className="p-2">
                            <p className="px-2 pb-1 text-xs font-bold uppercase tracking-wider text-gray-400">Doctors</p>
                            {doctors.map((d) => (
                                <Link key={d.id} href={`/consult/doctors/${d.id}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-primary/5">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"><Stethoscope className="h-4 w-4 text-primary" aria-hidden /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-bold text-gray-900">{d.displayName}</span>
                                        <span className="block truncate text-xs text-gray-500">{d.specialty.name} · {d.experienceYears} yrs exp</span>
                                    </span>
                                    <span className="text-sm font-bold text-gray-900">{formatRupees(d.consultationFee)}</span>
                                </Link>
                            ))}
                        </div>
                    )}
                    <div className="p-2">
                        <p className="px-2 pb-1 text-xs font-bold uppercase tracking-wider text-gray-400">Lab tests &amp; packages</p>
                        {tests.isLoading || debounced !== query ? (
                            <p className="flex items-center gap-2 px-2 py-2.5 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching…</p>
                        ) : tests.results.length > 0 ? (
                            tests.results.slice(0, 4).map((t) => (
                                <Link key={t.id} href={productHref(t)} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-teal-50">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50"><FlaskConical className="h-4 w-4 text-teal-700" aria-hidden /></span>
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{t.name}</span>
                                    <span className="text-sm font-bold text-gray-900">{formatRupees(t.price ?? t.displayPrice)}</span>
                                </Link>
                            ))
                        ) : (
                            <p className="px-2 py-2.5 text-sm text-gray-500">No lab tests match “{q}”.</p>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-gray-100 p-3">
                        <Link href={`/search?q=${encodeURIComponent(q)}`} onClick={() => setOpen(false)} className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800 hover:bg-teal-100">
                            All lab tests for “{q}”
                        </Link>
                        <Link href="/consult" onClick={() => setOpen(false)} className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/15">
                            Browse all doctors
                        </Link>
                    </div>
                </div>
            )}
        </form>
    );
}
