'use client';
import { Check, ChevronDown, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
    activeFilterCount, EXPERIENCE_STEPS, FEE_STEPS, NO_FILTERS, SORT_LABELS,
    type DoctorFilterState, type DoctorSort,
} from '@/lib/consult/doctorFilters';
import { formatRupees } from '@/lib/consult/format';

interface Option<T> { value: T; label: string }

/** A chip that opens a short list; filled purple once something is chosen. */
function FilterChip<T>({ label, active, options, selected, onPick, multi = false }: {
    label: string; active: boolean; options: Option<T>[]; selected: (v: T) => boolean; onPick: (v: T) => void; multi?: boolean;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-surface text-ink hover:bg-surface-subtle'}`}
            >
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

export function DoctorFilters({ value, onChange, languages, shown, total }: {
    value: DoctorFilterState; onChange: (next: DoctorFilterState) => void; languages: string[]; shown: number; total: number;
}) {
    const set = (patch: Partial<DoctorFilterState>) => onChange({ ...value, ...patch });
    const count = activeFilterCount(value);
    const toggle = <T,>(current: T | null, v: T) => (current === v ? null : v);

    return (
        <div className="space-y-3">
            <div role="group" aria-label="Filter and sort doctors" className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
                <FilterChip<DoctorSort>
                    label={value.sort === 'recommended' ? 'Sort' : SORT_LABELS[value.sort]}
                    active={value.sort !== 'recommended'}
                    options={(Object.keys(SORT_LABELS) as DoctorSort[]).map((s) => ({ value: s, label: SORT_LABELS[s] }))}
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
                        onPick={(l) => set({ languages: value.languages.includes(l) ? value.languages.filter((x) => x !== l) : [...value.languages, l] })}
                    />
                )}
                <FilterChip<'Female' | 'Male'>
                    label={value.gender ? `${value.gender} doctor` : 'Gender'}
                    active={!!value.gender}
                    options={[{ value: 'Female', label: 'Female doctor' }, { value: 'Male', label: 'Male doctor' }]}
                    selected={(g) => value.gender === g}
                    onPick={(g) => set({ gender: toggle(value.gender, g) })}
                />
                <FilterChip<number>
                    label={value.minExperience !== null ? `${value.minExperience}+ years` : 'Experience'}
                    active={value.minExperience !== null}
                    options={EXPERIENCE_STEPS.map((y) => ({ value: y, label: `${y}+ years` }))}
                    selected={(y) => value.minExperience === y}
                    onPick={(y) => set({ minExperience: toggle(value.minExperience, y) })}
                />
                <FilterChip<number>
                    label={value.maxFee !== null ? `Up to ${formatRupees(value.maxFee)}` : 'Fee'}
                    active={value.maxFee !== null}
                    options={FEE_STEPS.map((f) => ({ value: f, label: `Up to ${formatRupees(f)}` }))}
                    selected={(f) => value.maxFee === f}
                    onPick={(f) => set({ maxFee: toggle(value.maxFee, f) })}
                />
                {(count > 0 || value.sort !== 'recommended') && (
                    <button
                        type="button"
                        onClick={() => onChange(NO_FILTERS)}
                        className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:underline"
                    >
                        <X className="h-4 w-4" aria-hidden /> Clear all
                    </button>
                )}
            </div>
            <p className="text-sm text-ink-muted" aria-live="polite">
                {count > 0 ? `Showing ${shown} of ${total} doctors` : `${total} ${total === 1 ? 'doctor' : 'doctors'}`}
            </p>
        </div>
    );
}
