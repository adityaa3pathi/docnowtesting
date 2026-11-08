import { ChevronDown } from 'lucide-react';
import { ABOUT_TELEMEDICINE } from '@/lib/consult/consent';

// Short questions over the approved telemedicine text (consent.ts); the answers are its own words.
const QUESTIONS = ['Who will I talk to?', 'What can the doctor prescribe?', 'What if I need an examination?', 'Is this for emergencies?', 'Who sees my health details?', 'Can I leave the call?'];

export function GoodToKnow() {
    const points = ABOUT_TELEMEDICINE.en.points;
    return (
        <section aria-labelledby="good-title" className="container mx-auto max-w-3xl px-4">
            <h2 id="good-title" className="text-2xl font-semibold text-ink">Good to know before you book</h2>
            <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
                {points.map((answer, i) => (
                    <details key={answer} className="group px-5 [&_summary::-webkit-details-marker]:hidden">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            {QUESTIONS[i] ?? 'More'}
                            <ChevronDown className="h-5 w-5 shrink-0 text-ink-subtle transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                        </summary>
                        <p className="max-w-prose pb-5 text-base text-ink-muted">{answer}</p>
                    </details>
                ))}
            </div>
        </section>
    );
}
