import { ClipboardList, PhoneCall, Smartphone, Users } from 'lucide-react';

// Same facts as the home page's family section (FamilyCareSpotlight), in the consult page's style.
const POINTS = [
    { icon: Smartphone, title: 'No app or login for your parents', body: 'They get a WhatsApp link that opens a senior-friendly video room with large Hindi and English buttons.' },
    { icon: Users, title: 'Join the call to help', body: 'Join the same call from your phone to explain symptoms and hear the doctor first-hand.' },
    { icon: ClipboardList, title: 'The doctor comes prepared', body: 'Add conditions like BP or diabetes, allergies, daily medicines and old reports when you book.' },
];

/** A drawn phone, not a photo: what the parent actually sees after tapping the WhatsApp link. */
function ParentPhone() {
    return (
        <div role="img" aria-label="A parent's phone showing the DocNow call room with a large Start call button" className="mx-auto w-full max-w-[280px]">
            <div className="rounded-[2rem] border-8 border-ink bg-surface p-4 shadow-raised" aria-hidden>
                <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-surface-muted" />
                <p className="text-lg font-semibold text-ink">नमस्ते सुनीता जी</p>
                <p className="text-sm text-ink-muted">Namaste Sunita ji</p>
                <div className="mt-4 rounded-xl border border-border p-3">
                    <p className="text-sm font-medium text-ink">Your doctor is ready</p>
                    <p className="text-sm text-ink-muted">Today, 5:30 PM</p>
                </div>
                <div className="mt-4 flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-center font-semibold text-on-primary">
                    <PhoneCall className="h-5 w-5" /> Start call
                </div>
                <p className="mt-3 text-center text-sm text-ink-muted">No app or login needed</p>
            </div>
        </div>
    );
}

export function FamilyBooking() {
    return (
        <section aria-labelledby="family-title" className="container mx-auto max-w-6xl px-4">
            <div className="grid items-center gap-10 rounded-2xl bg-primary-soft p-6 md:p-10 lg:grid-cols-[1.3fr_1fr]">
                <div>
                    <h2 id="family-title" className="text-2xl font-semibold text-ink md:text-3xl">Book a doctor for your parents</h2>
                    <p className="mt-2 max-w-prose text-base text-ink-muted">Wherever you are, you can book and pay, and your parents just tap a link.</p>
                    <ul className="mt-6 space-y-5">
                        {POINTS.map(({ icon: Icon, title, body }) => (
                            <li key={title} className="flex gap-4">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary"><Icon className="h-5 w-5" aria-hidden /></span>
                                <span>
                                    <span className="block font-medium text-ink">{title}</span>
                                    <span className="block text-sm text-ink-muted">{body}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                    <a href="#doctors" className="mt-8 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                        Choose a doctor for them
                    </a>
                </div>
                <ParentPhone />
            </div>
        </section>
    );
}
