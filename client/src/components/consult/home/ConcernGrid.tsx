import { ChevronRight } from 'lucide-react';
import { HOME_SPECIALTIES } from '@/lib/home/specialties';
import type { Specialty } from '@/lib/consult/types';

/**
 * "What do you need help with?": people know their problem, not the specialty's name. Only
 * concerns this deployment actually has doctors for are shown.
 */
export function ConcernGrid({ specialties, onPick }: { specialties: Specialty[]; onPick: (id: string) => void }) {
    const offered = HOME_SPECIALTIES.flatMap((h) => {
        const match = specialties.find((s) => s.slug.toLowerCase() === h.key || h.match.test(`${s.slug} ${s.name}`.toLowerCase()));
        return match ? [{ ...h, id: match.id }] : [];
    });
    if (offered.length === 0) return null;
    return (
        <section aria-labelledby="concerns-title" className="container mx-auto max-w-6xl px-4">
            <h2 id="concerns-title" className="text-2xl font-bold text-ink">What do you need help with?</h2>
            <p className="mt-1 text-base text-ink-muted">Pick what is bothering you and we will show the right doctors.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {offered.map((c) => (
                    <button
                        key={c.key}
                        type="button"
                        onClick={() => onPick(c.id)}
                        className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <span className="min-w-0">
                            <span className="block font-medium text-ink">{c.symptoms.join(', ')}</span>
                            <span className="mt-0.5 block text-sm text-ink-muted">{c.name}</span>
                        </span>
                        <ChevronRight className="h-5 w-5 shrink-0 text-ink-subtle transition-colors group-hover:text-primary" aria-hidden />
                    </button>
                ))}
            </div>
        </section>
    );
}
