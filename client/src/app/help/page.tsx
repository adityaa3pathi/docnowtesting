import { Headphones, Mail, Phone } from 'lucide-react';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { Card } from '@/components/ui';
import { RichTextRenderer } from '@/components/support/RichTextRenderer';
import { getHelpCenterContent } from '@/lib/supportContent';
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_LINK } from '@/lib/supportConfig';

export default async function HelpPage() {
    const helpContent = await getHelpCenterContent();

    return (
        <main className="flex min-h-screen flex-col bg-white">
            <Header />

            <section className="relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 py-20 text-white md:py-24">
                <div className="absolute inset-x-0 top-0 h-40 bg-white/5 blur-3xl" />
                <div className="absolute -bottom-16 right-0 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
                <div className="container relative z-10 mx-auto max-w-4xl px-4 text-center">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 backdrop-blur-sm">
                        <Headphones className="h-8 w-8 text-white" />
                    </div>
                    <p className="mb-4 text-xs font-black uppercase tracking-[0.35em] text-white/60">
                        Help Center
                    </p>
                    <h1 className="text-4xl font-black leading-tight md:text-6xl">
                        {helpContent.title}
                    </h1>
                    {helpContent.subtitle ? (
                        <p className="mt-4 text-lg font-semibold text-white/85 md:text-xl">
                            {helpContent.subtitle}
                        </p>
                    ) : null}
                </div>
            </section>

            <section className="bg-white py-12 md:py-20">
                <div className="container mx-auto max-w-5xl px-4">
                    <Card className="border-primary/10 bg-primary/[0.03] p-6 md:p-8">
                        <RichTextRenderer blocks={helpContent.intro} className="text-base leading-8" />
                    </Card>

                    <div className="mt-8 space-y-6">
                        {helpContent.sections.map((section) => (
                            <Card key={section.title} className="border-border/60 p-6 md:p-8">
                                <h2 className="text-2xl font-black text-foreground">{section.title}</h2>
                                <RichTextRenderer blocks={section.blocks} className="mt-4" />
                            </Card>
                        ))}
                    </div>

                    <div className="mt-10 grid gap-4 md:grid-cols-2">
                        <a
                            href={`tel:${SUPPORT_PHONE_LINK}`}
                            className="rounded-2xl border border-border bg-slate-50 p-5 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
                        >
                            <div className="flex items-center gap-3">
                                <Phone className="h-5 w-5 text-primary" />
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.25em] text-primary/60">
                                        Call Or WhatsApp
                                    </p>
                                    <p className="mt-2 text-lg font-black text-foreground">{SUPPORT_PHONE_DISPLAY}</p>
                                </div>
                            </div>
                        </a>
                        <a
                            href={`mailto:${SUPPORT_EMAIL}`}
                            className="rounded-2xl border border-border bg-slate-50 p-5 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
                        >
                            <div className="flex items-center gap-3">
                                <Mail className="h-5 w-5 text-primary" />
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.25em] text-primary/60">
                                        Email Support
                                    </p>
                                    <p className="mt-2 text-lg font-black text-foreground">{SUPPORT_EMAIL}</p>
                                </div>
                            </div>
                        </a>
                    </div>
                </div>
            </section>

            <Footer />
        </main>
    );
}
