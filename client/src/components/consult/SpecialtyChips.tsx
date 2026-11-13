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
        // No visible scroll bar (it read as a broken line); the faded right edge shows there is more to swipe.
        <div role="group" aria-label="Filter by specialty" className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,black_88%,transparent)] md:[mask-image:none] md:flex-wrap">
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
