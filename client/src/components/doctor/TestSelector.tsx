'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import api from '@/lib/api';

interface CatalogTest {
    partnerCode: string;
    name: string;
}

/** Same cap as the server's prescription schema. */
export const MAX_TESTS = 10;

const TYPES = 'TEST,PROFILE';

interface TestSelectorProps {
    selectedCodes: string[];
    onChange: (codes: string[]) => void;
    /** Names for codes already on the prescription (corrections), so chips don't show bare codes. */
    knownNames?: Record<string, string>;
}

/** Catalog test picker. The list stays open so the doctor can tick several tests in a row. */
export function TestSelector({ selectedCodes, onChange, knownNames }: TestSelectorProps) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [results, setResults] = useState<CatalogTest[]>([]);
    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [loadedFor, setLoadedFor] = useState<string | null>(null);
    const [names, setNames] = useState<Record<string, string>>(knownNames ?? {});
    const boxRef = useRef<HTMLDivElement>(null);
    const listId = useId();
    const full = selectedCodes.length >= MAX_TESTS;

    // An empty box shows the common tests, so the doctor can pick without typing.
    useEffect(() => {
        const q = query.trim();
        if (!open || q.length === 1) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            setStatus('loading');
            try {
                const get = async (path: string, params: Record<string, string | number>) =>
                    ((await api.get(path, { params })).data.products ?? []) as CatalogTest[];
                let found = q
                    ? await get('/catalog/products', { search: q, type: TYPES, limit: 20 })
                    : await get('/catalog/featured', { type: TYPES, limit: 12 });
                if (!q && found.length === 0) found = await get('/catalog/products', { type: TYPES, limit: 20 });
                if (cancelled) return;
                setResults(found);
                setLoadedFor(q);
                setNames((n) => ({ ...n, ...Object.fromEntries(found.map((t) => [t.partnerCode, t.name])) }));
                setStatus('idle');
            } catch {
                if (!cancelled) setStatus('error');
            }
        }, q ? 300 : 0);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, open]);

    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const toggle = (code: string) =>
        onChange(selectedCodes.includes(code) ? selectedCodes.filter((c) => c !== code) : [...selectedCodes, code]);

    return (
        <div className="space-y-2" ref={boxRef}>
            {selectedCodes.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Selected tests">
                    {selectedCodes.map((code) => (
                        <li key={code} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1.5 pl-3 pr-1.5 text-sm font-semibold text-primary">
                            {names[code] ?? code}
                            <button type="button" onClick={() => toggle(code)} className="rounded-full p-0.5 hover:bg-primary/20" aria-label={`Remove ${names[code] ?? code}`}>
                                <X className="h-3.5 w-3.5" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-label="Search tests"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onClick={() => setOpen(true)}
                    placeholder="Tap to pick tests, or search (CBC, TSH, Lipid)"
                    className="w-full rounded-xl border border-border bg-input py-2.5 pl-10 pr-9 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
                />
                {status === 'loading' && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
            </div>

            {/* In the page flow, not floating, so no card or call layout can clip it. */}
            {open && (
                <div id={listId} className="max-h-72 overflow-y-auto rounded-xl border border-border bg-white shadow-sm">
                    {full && <p className="border-b border-border bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">You can add up to {MAX_TESTS} tests.</p>}
                    {status === 'error' ? (
                        <p role="alert" className="p-4 text-center text-sm text-destructive">Could not load tests. Check your internet and try again.</p>
                    ) : query.trim().length === 1 ? (
                        <p className="p-4 text-center text-sm text-muted-foreground">Type one more letter to search.</p>
                    ) : loadedFor !== query.trim() ? (
                        <p className="p-4 text-center text-sm text-muted-foreground">Loading tests...</p>
                    ) : results.length === 0 ? (
                        <p className="p-4 text-center text-sm text-muted-foreground">No tests found. Try the test name or code.</p>
                    ) : (
                        <ul>
                            {results.map((t) => {
                                const picked = selectedCodes.includes(t.partnerCode);
                                return (
                                    <li key={t.partnerCode} className="border-b border-gray-100 last:border-b-0">
                                        <button type="button" aria-pressed={picked} disabled={!picked && full} onClick={() => toggle(t.partnerCode)}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50">
                                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${picked ? 'border-primary bg-primary text-white' : 'border-gray-300'}`}>
                                                {picked && <Check className="h-3.5 w-3.5" aria-hidden />}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-semibold text-foreground">{t.name}</span>
                                                <span className="block text-xs text-muted-foreground">{t.partnerCode}</span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <div className="sticky bottom-0 flex items-center justify-between border-t border-border bg-white px-4 py-2">
                        <span className="text-xs text-muted-foreground">{selectedCodes.length} of {MAX_TESTS} selected</span>
                        <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-primary">Done</button>
                    </div>
                </div>
            )}
        </div>
    );
}
