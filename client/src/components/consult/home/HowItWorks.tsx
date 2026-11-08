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
                <h2 id="how-title" className="text-2xl font-bold text-ink">How a consultation works</h2>
                <ol className="mt-8 grid gap-8 md:grid-cols-4 md:gap-6">
                    {STEPS.map(({ icon: Icon, title, body }, i) => (
                        <li key={title} className="relative">
                            {i < STEPS.length - 1 && <span aria-hidden className="absolute left-12 right-0 top-5 hidden h-px bg-border-strong/40 md:block" />}
                            <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary">{i + 1}</span>
                            <h3 className="mt-4 flex items-center gap-2 font-semibold text-ink"><Icon className="h-4 w-4 text-primary" aria-hidden />{title}</h3>
                            <p className="mt-1 text-sm text-ink-muted">{body}</p>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
