import { Mail, MessageCircleMore, Phone } from 'lucide-react';

import { Footer } from '@/components/Footer';
import { Card } from '@/components/ui';
import { RichTextRenderer } from '@/components/support/RichTextRenderer';
import { getSupportFaqs } from '@/lib/supportContent';
import { SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_LINK } from '@/lib/supportConfig';

export default async function FaqsPage() {
    const faqs = await getSupportFaqs();

    return (
        <main className="flex min-h-screen flex-col bg-white">

            <section className="relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 py-20 text-white md:py-24">
                <div className="absolute -top-28 -right-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
                <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
                <div className="container relative z-10 mx-auto max-w-4xl px-4 text-center">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 backdrop-blur-sm">
                        <MessageCircleMore className="h-8 w-8 text-white" />
                    </div>
                    <p className="mb-4 text-xs font-black uppercase tracking-[0.35em] text-white/60">
                        Support Answers
                    </p>
                    <h1 className="text-4xl font-black leading-tight md:text-6xl">
                        Frequently Asked Questions
                    </h1>
                    <p className="mx-auto mt-6 max-w-2xl text-base font-medium leading-7 text-white/85 md:text-lg">
                        Everything currently published in our root FAQ document, organized into quick answers for bookings, reports, payments, support, and policy questions.
                    </p>
                </div>
            </section>

            <section className="bg-slate-50 py-12 md:py-20">
                <div className="container mx-auto max-w-6xl px-4">
                    <div className="grid gap-6 md:grid-cols-2">
                        {faqs.map((faq) => (
                            <Card
                                key={faq.number}
                                className="border-border/60 p-6 shadow-sm shadow-slate-200/50"
                            >
                                <p className="text-xs font-black uppercase tracking-[0.25em] text-primary/60">
                                    Question {faq.number}
                                </p>
                                <h2 className="mt-3 text-xl font-black leading-tight text-foreground">
                                    {faq.question}
                                </h2>
                                <RichTextRenderer blocks={faq.blocks} className="mt-5" />
                            </Card>
                        ))}
                    </div>

                    <Card className="mt-10 border-primary/15 bg-white p-6 md:p-8">
                        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                            <div className="max-w-2xl">
                                <p className="text-xs font-black uppercase tracking-[0.25em] text-primary/60">
                                    Need Personal Help
                                </p>
                                <h2 className="mt-3 text-2xl font-black text-foreground">
                                    Our support team is available for booking, rescheduling, and report queries.
                                </h2>
                            </div>
                            <div className="space-y-3 text-sm font-semibold text-foreground">
                                <a href={`tel:${SUPPORT_PHONE_LINK}`} className="flex items-center gap-3 hover:text-primary">
                                    <Phone className="h-4 w-4 text-primary" />
                                    {SUPPORT_PHONE_DISPLAY}
                                </a>
                                <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-3 hover:text-primary">
                                    <Mail className="h-4 w-4 text-primary" />
                                    {SUPPORT_EMAIL}
                                </a>
                            </div>
                        </div>
                    </Card>
                </div>
            </section>

            <Footer />
        </main>
    );
}
