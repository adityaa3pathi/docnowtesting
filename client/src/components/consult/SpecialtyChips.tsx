import { cn } from '@/lib/utils';
import type { Specialty } from '@/lib/consult/types';

interface Props {
    specialties: Specialty[];
    value: string | null;
    onChange: (id: string | null) => void;
}

export function SpecialtyChips({ specialties, value, onChange }: Props) {
    const chip = (active: boolean) =>
        cn(
            'inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            active ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-ink hover:border-border-strong'
        );
    return (
        <div role="group" aria-label="Filter by specialty" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={chip(value === null)}>
                All
            </button>
            {specialties.map((s) => (
                <button key={s.id} type="button" aria-pressed={value === s.id} onClick={() => onChange(s.id)} className={chip(value === s.id)}>
                    {s.name}
                </button>
            ))}
        </div>
    );
}
