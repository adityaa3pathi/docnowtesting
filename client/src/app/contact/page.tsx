import { Clock3, Mail, MessageSquareText, Phone } from 'lucide-react';

import { Footer } from '@/components/Footer';
import { Card } from '@/components/ui';
import { RichTextRenderer } from '@/components/support/RichTextRenderer';
import { getContactPageContent } from '@/lib/supportContent';
import {
    SUPPORT_EMAIL,
    SUPPORT_HOURS,
    SUPPORT_PHONE_DISPLAY,
    SUPPORT_PHONE_LINK,
} from '@/lib/supportConfig';

export default async function ContactPage() {
    const contactContent = await getContactPageContent();

    return (
        <main className="flex min-h-screen flex-col bg-slate-50">

            <section className="relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 py-20 text-white md:py-24">
                <div className="absolute -top-20 left-10 h-60 w-60 rounded-full bg-white/10 blur-3xl" />
                <div className="absolute -bottom-24 right-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
                <div className="container relative z-10 mx-auto max-w-4xl px-4 text-center">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 backdrop-blur-sm">
                        <MessageSquareText className="h-8 w-8 text-white" />
                    </div>
                    <p className="mb-4 text-xs font-black uppercase tracking-[0.35em] text-white/60">
                        Contact Support
                    </p>
                    <h1 className="text-4xl font-black leading-tight md:text-6xl">
                        {contactContent.title}
                    </h1>
                    {contactContent.subtitle ? (
                        <p className="mt-4 text-lg font-semibold text-white/85 md:text-xl">
                            {contactContent.subtitle}
                        </p>
                    ) : null}
                </div>
            </section>

            <section className="py-12 md:py-20">
                <div className="container mx-auto max-w-6xl px-4">
                    <div className="grid gap-4 md:grid-cols-3">
                        <a
                            href={`tel:${SUPPORT_PHONE_LINK}`}
                            className="rounded-2xl border border-border bg-white p-6 shadow-sm transition-colors hover:border-primary/40"
                        >
                            <Phone className="h-6 w-6 text-primary" />
                            <p className="mt-4 text-xs font-black uppercase tracking-[0.25em] text-primary/60">
                                Call Or WhatsApp
                            </p>
                            <p className="mt-2 text-xl font-black text-foreground">{SUPPORT_PHONE_DISPLAY}</p>
                        </a>
                        <a
                            href={`mailto:${SUPPORT_EMAIL}`}
                            className="rounded-2xl border border-border bg-white p-6 shadow-sm transition-colors hover:border-primary/40"
                        >
                            <Mail className="h-6 w-6 text-primary" />
                            <p className="mt-4 text-xs font-black uppercase tracking-[0.25em] text-primary/60">
                                Email Support
                            </p>
                            <p className="mt-2 break-all text-xl font-black text-foreground">{SUPPORT_EMAIL}</p>
                        </a>
                        <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
                            <Clock3 className="h-6 w-6 text-primary" />
                            <p className="mt-4 text-xs font-black uppercase tracking-[0.25em] text-primary/60">
                                Support Hours
                            </p>
                            <p className="mt-2 text-xl font-black text-foreground">{SUPPORT_HOURS}</p>
                        </div>
                    </div>

                    <Card className="mt-8 border-primary/10 bg-white p-6 md:p-8">
                        <RichTextRenderer blocks={contactContent.intro} className="text-base leading-8" />
                    </Card>

                    <div className="mt-8 space-y-6">
                        {contactContent.sections.map((section) => (
                            <Card key={section.title} className="border-border/60 bg-white p-6 md:p-8">
                                <h2 className="text-2xl font-black text-foreground">{section.title}</h2>
                                <RichTextRenderer blocks={section.blocks} className="mt-4" />

                                {section.subsections?.length ? (
                                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                                        {section.subsections.map((subsection) => (
                                            <div
                                                key={subsection.title}
                                                className="rounded-2xl border border-border bg-slate-50 p-5"
                                            >
                                                <h3 className="text-lg font-black text-foreground">
                                                    {subsection.title}
                                                </h3>
                                                <RichTextRenderer
                                                    blocks={subsection.blocks}
                                                    className="mt-3"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </Card>
                        ))}
                    </div>
                </div>
            </section>

            <Footer />
        </main>
    );
}
