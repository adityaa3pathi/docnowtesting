'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
    activeFilterCount, EXPERIENCE_STEPS, FEE_STEPS, isFiltered, NO_FILTERS, SEARCH_MAX, SORT_LABELS, withFilters,
    type DoctorFilterState, type DoctorSort,
} from '@/lib/consult/doctorFilters';
import { formatRupees } from '@/lib/consult/format';

interface Option<T> { value: T; label: string }

const SEARCH_DELAY_MS = 300;
const chipBase = 'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const chipTone = (active: boolean) => (active ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-surface text-ink hover:bg-surface-subtle');

const SORTS = (Object.keys(SORT_LABELS) as DoctorSort[]).map((s) => ({ value: s, label: SORT_LABELS[s] }));
const GENDERS: Option<'Female' | 'Male'>[] = [{ value: 'Female', label: 'Female doctor' }, { value: 'Male', label: 'Male doctor' }];
const EXPERIENCE = EXPERIENCE_STEPS.map((y) => ({ value: y, label: `${y}+ years` }));
const FEES = FEE_STEPS.map((f) => ({ value: f, label: `Up to ${formatRupees(f)}` }));
const toggle = <T,>(current: T | null, v: T) => (current === v ? null : v);
const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** A chip that opens a short list; filled purple once something is chosen. */
function FilterChip<T>({ label, active, options, selected, onPick, multi = false }: {
    label: string; active: boolean; options: Option<T>[]; selected: (v: T) => boolean; onPick: (v: T) => void; multi?: boolean;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger className={`${chipBase} ${chipTone(active)}`}>
                {label}
                <ChevronDown className="h-4 w-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52">
                {options.map((o) => (
                    <DropdownMenuItem
                        key={String(o.value)}
                        // Multi-choice lists stay open so several languages can be ticked in one go.
                        onSelect={(e) => { if (multi) e.preventDefault(); onPick(o.value); }}
                        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm"
                        aria-checked={selected(o.value)}
                        role={multi ? 'menuitemcheckbox' : 'menuitemradio'}
                    >
                        {o.label}
                        {selected(o.value) && <Check className="h-4 w-4 text-primary" aria-hidden />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function OnlineChip({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button type="button" aria-pressed={on} onClick={onToggle} className={`${chipBase} ${chipTone(on)}`}>
            <span aria-hidden className={`h-2 w-2 rounded-full ${on ? 'bg-on-primary' : 'bg-success'}`} />
            Online now
        </button>
    );
}

/** Name search; typing waits a moment before the list reloads. */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
    const [text, setText] = useState(value);
    const [seen, setSeen] = useState(value);
    const [sent, setSent] = useState(value);
    // Changed from outside (Clear all, back button): show it. Our own search coming back from the
    // URL is skipped, so letters typed while it was on its way are kept.
    if (value !== seen) {
        setSeen(value);
        if (value !== sent.trim()) {
            setText(value);
            setSent(value);
        }
    }
    const latest = useRef(onSearch);
    useEffect(() => { latest.current = onSearch; });
    useEffect(() => {
        if (text.trim() === value.trim()) return;
        const t = setTimeout(() => {
            setSent(text);
            latest.current(text);
        }, SEARCH_DELAY_MS);
        return () => clearTimeout(t);
    }, [text, value]);
    return (
        <div className="relative md:max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input
                type="search"
                value={text}
                maxLength={SEARCH_MAX}
                onChange={(e) => setText(e.target.value)}
                placeholder="Search doctors by name"
                aria-label="Search doctors by name"
                className="h-11 w-full rounded-full border border-border-strong bg-surface pl-10 pr-4 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:text-sm"
            />
        </div>
    );
}

function SheetGroup<T>({ title, options, selected, onPick, multi = false }: {
    title: string; options: Option<T>[]; selected: (v: T) => boolean; onPick: (v: T) => void; multi?: boolean;
}) {
    return (
        <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">{title}</legend>
            <div className="flex flex-wrap gap-2">
                {options.map((o) => (
                    <button
                        key={String(o.value)}
                        type="button"
                        role={multi ? 'checkbox' : 'radio'}
                        aria-checked={selected(o.value)}
                        onClick={() => onPick(o.value)}
                        className={`${chipBase} ${chipTone(selected(o.value))}`}
                    >
                        {selected(o.value) && <Check className="h-4 w-4" aria-hidden />}
                        {o.label}
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

/** Phones: every filter and the sort in one bottom sheet; nothing changes until "Show doctors". */
function FilterSheet({ value, onChange, languages }: { value: DoctorFilterState; onChange: (next: DoctorFilterState) => void; languages: string[] }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(value);
    const set = (patch: Partial<DoctorFilterState>) => setDraft((d) => ({ ...d, ...patch }));
    const count = activeFilterCount(value) - (value.now ? 1 : 0) + (value.sort !== 'recommended' ? 1 : 0);
    return (
        <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (o) setDraft(value); setOpen(o); }}>
            <DialogPrimitive.Trigger className={`${chipBase} ${chipTone(count > 0)}`}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                {count > 0 ? `Filters · ${count}` : 'Filters'}
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
                <DialogPrimitive.Content
                    className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-surface shadow-raised focus:outline-none"
                    aria-describedby={undefined}
                >
                    <div className="flex items-center justify-between border-b border-border px-4 py-3">
                        <DialogPrimitive.Title className="text-lg font-bold text-ink">Filter and sort</DialogPrimitive.Title>
                        <DialogPrimitive.Close className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            <X className="h-5 w-5" aria-hidden /><span className="sr-only">Close</span>
                        </DialogPrimitive.Close>
                    </div>
                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
                        <SheetGroup<DoctorSort> title="Sort by" options={SORTS} selected={(s) => draft.sort === s} onPick={(s) => set({ sort: s })} />
                        {languages.length > 0 && (
                            <SheetGroup<string> multi title="Language" options={languages.map((l) => ({ value: l, label: l }))}
                                selected={(l) => draft.languages.includes(l)} onPick={(l) => set({ languages: toggleIn(draft.languages, l) })} />
                        )}
                        <SheetGroup title="Gender" options={GENDERS} selected={(g) => draft.gender === g} onPick={(g) => set({ gender: toggle(draft.gender, g) })} />
                        <SheetGroup title="Experience" options={EXPERIENCE} selected={(y) => draft.minExperience === y} onPick={(y) => set({ minExperience: toggle(draft.minExperience, y) })} />
                        <SheetGroup title="Fee" options={FEES} selected={(f) => draft.maxFee === f} onPick={(f) => set({ maxFee: toggle(draft.maxFee, f) })} />
                    </div>
                    <div className="flex gap-3 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                        <button
                            type="button"
                            onClick={() => setDraft({ ...NO_FILTERS, q: draft.q, now: draft.now })}
                            className="h-12 flex-1 rounded-lg border border-border-strong text-sm font-semibold text-ink hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                // Only what the sheet owns: a search or Online now changed while it was open stays.
                                const { sort, languages: langs, gender, minExperience, maxFee } = draft;
                                onChange(withFilters(value, { sort, languages: langs, gender, minExperience, maxFee }));
                                setOpen(false);
                            }}
                            className="h-12 flex-[2] rounded-lg bg-primary text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                            Show doctors
                        </button>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

export function DoctorFilters({ value, onChange, languages, total, loading }: {
    value: DoctorFilterState; onChange: (next: DoctorFilterState) => void; languages: string[]; total: number | null; loading: boolean;
}) {
    const set = (patch: Partial<DoctorFilterState>) => onChange(withFilters(value, patch));
    const clearAll = () => onChange({ ...NO_FILTERS });

    return (
        <div className="space-y-3">
            <SearchBox value={value.q} onSearch={(q) => set({ q })} />

            {/* Phones: Online now stays one tap away; everything else is in the sheet. */}
            <div role="group" aria-label="Filter and sort doctors" className="flex gap-2 md:hidden">
                <OnlineChip on={value.now} onToggle={() => set({ now: !value.now })} />
                <FilterSheet value={value} onChange={onChange} languages={languages} />
            </div>

            <div role="group" aria-label="Filter and sort doctors" className="hidden flex-wrap gap-2 md:flex">
                <OnlineChip on={value.now} onToggle={() => set({ now: !value.now })} />
                <FilterChip<DoctorSort>
                    label={value.sort === 'recommended' ? 'Sort' : SORT_LABELS[value.sort]}
                    active={value.sort !== 'recommended'}
                    options={SORTS}
                    selected={(s) => value.sort === s}
                    onPick={(s) => set({ sort: s })}
                />
                {languages.length > 0 && (
                    <FilterChip<string>
                        multi
                        label={value.languages.length ? `Language · ${value.languages.length}` : 'Language'}
                        active={value.languages.length > 0}
                        options={languages.map((l) => ({ value: l, label: l }))}
                        selected={(l) => value.languages.includes(l)}
                        onPick={(l) => set({ languages: toggleIn(value.languages, l) })}
                    />
                )}
                <FilterChip<'Female' | 'Male'>
                    label={value.gender ? `${value.gender} doctor` : 'Gender'}
                    active={!!value.gender}
                    options={GENDERS}
                    selected={(g) => value.gender === g}
                    onPick={(g) => set({ gender: toggle(value.gender, g) })}
                />
                <FilterChip<number>
                    label={value.minExperience !== null ? `${value.minExperience}+ years` : 'Experience'}
                    active={value.minExperience !== null}
                    options={EXPERIENCE}
                    selected={(y) => value.minExperience === y}
                    onPick={(y) => set({ minExperience: toggle(value.minExperience, y) })}
                />
                <FilterChip<number>
                    label={value.maxFee !== null ? `Up to ${formatRupees(value.maxFee)}` : 'Fee'}
                    active={value.maxFee !== null}
                    options={FEES}
                    selected={(f) => value.maxFee === f}
                    onPick={(f) => set({ maxFee: toggle(value.maxFee, f) })}
                />
                {isFiltered(value) && (
                    <button type="button" onClick={clearAll} className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:underline">
                        <X className="h-4 w-4" aria-hidden /> Clear all
                    </button>
                )}
            </div>

            <div className="flex min-h-6 items-center justify-between gap-3">
                <p className="text-sm text-ink-muted" aria-live="polite">
                    {total === null ? (loading ? 'Loading doctors…' : '') : `${total} ${total === 1 ? 'doctor' : 'doctors'}${activeFilterCount(value) > 0 || value.q.trim() ? ' match' : ''}`}
                </p>
                {isFiltered(value) && (
                    <button type="button" onClick={clearAll} className="text-sm font-medium text-primary hover:underline md:hidden">Clear all</button>
                )}
            </div>
        </div>
    );
}
