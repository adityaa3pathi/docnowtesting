import { Calendar, ClipboardList, CreditCard, Video } from 'lucide-react';

// The order matters (you can't join before paying), so the steps are numbered and joined by a line.
const STEPS = [
    { icon: Calendar, title: 'Choose a doctor and time', body: 'All times are in Indian time. You can book for yourself or a family member.' },
    { icon: CreditCard, title: 'Pay to confirm', body: 'Your slot is held while you pay. You see the exact refund before you ever cancel.' },
    { icon: Video, title: 'Join the call', body: 'From your phone or laptop, up to 10 minutes before the start. You can switch to audio any time.' },
    { icon: ClipboardList, title: 'Get your prescription', body: 'It appears on your phone after the call. Recommended tests go to your cart in one tap.' },
];

export function HowItWorks() {
    return (
        <section aria-labelledby="how-title" className="border-y border-border bg-surface-subtle">
            <div className="container mx-auto max-w-6xl px-4 py-14">
                <h2 id="how-title" className="text-2xl font-bold text-ink md:text-3xl">How a consultation works</h2>
                <p className="mt-2 text-base text-ink-muted">Four steps, from booking to your prescription.</p>
                {/* Phone: a numbered rail down the left. Desktop: four cards joined by a line. */}
                <ol className="mt-8 md:grid md:grid-cols-4 md:gap-6">
                    {STEPS.map(({ icon: Icon, title, body }, i) => (
                        <li key={title} className="relative flex gap-4 pb-6 last:pb-0 md:flex-col md:gap-4 md:pb-0">
                            {i < STEPS.length - 1 && (
                                <>
                                    <span aria-hidden className="absolute bottom-0 left-5 top-10 w-0.5 -translate-x-1/2 bg-primary/20 md:hidden" />
                                    <span aria-hidden className="absolute left-12 right-0 top-5 hidden h-0.5 bg-primary/20 md:block" />
                                </>
                            )}
                            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-on-primary">{i + 1}</span>
                            <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface p-4 md:p-5">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                                        <Icon className="h-5 w-5" aria-hidden />
                                    </span>
                                    <h3 className="text-base font-bold leading-snug text-ink">{title}</h3>
                                </div>
                                <p className="mt-3 text-sm leading-relaxed text-ink-muted">{body}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
