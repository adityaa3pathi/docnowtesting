"use client";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui";
import {
    FileText,
    UserCheck,
    CalendarCheck,
    CreditCard,
    ClipboardList,
    RotateCcw,
    AlertTriangle,
    Lock,
    Copyright,
    Ban,
    Handshake,
    RefreshCw,
    Scale,
    Mail,
    Heart,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  TABLE OF CONTENTS                                                  */
/* ------------------------------------------------------------------ */

const tocItems = [
    { id: "about", label: "About DocNow Healthcare", number: "1" },
    { id: "eligibility", label: "Eligibility", number: "2" },
    { id: "booking-service", label: "Booking & Service Terms", number: "3" },
    { id: "payments", label: "Payments & Pricing", number: "4" },
    { id: "reports", label: "Reports & Medical Disclaimer", number: "5" },
    { id: "cancellation", label: "Cancellation & Refund", number: "6" },
    { id: "liability", label: "Limitation of Liability", number: "7" },
    { id: "privacy", label: "Privacy & Data Protection", number: "8" },
    { id: "ip", label: "Intellectual Property", number: "9" },
    { id: "prohibited", label: "Prohibited Use", number: "10" },
    { id: "third-party", label: "Third-Party Services", number: "11" },
    { id: "amendments", label: "Amendments", number: "12" },
    { id: "governing-law", label: "Governing Law", number: "13" },
    { id: "contact", label: "Contact Information", number: "14" },
];

/* ------------------------------------------------------------------ */
/*  SECTION COMPONENT                                                  */
/* ------------------------------------------------------------------ */

function TermsSection({
    id,
    number,
    title,
    icon: Icon,
    children,
}: {
    id: string;
    number: string;
    title: string;
    icon: React.ElementType;
    children: React.ReactNode;
}) {
    return (
        <section id={id} className="scroll-mt-24">
            <div className="flex items-start gap-4 mb-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-foreground pt-1">
                    {number}. {title}
                </h2>
            </div>
            <div className="pl-0 md:pl-[60px] space-y-4 text-muted-foreground font-medium leading-relaxed">
                {children}
            </div>
        </section>
    );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function TermsPage() {
    return (
        <main className="flex flex-col min-h-screen">
            <Header />

            {/* ── Hero ────────────────────────────────────────────────── */}
            <section className="relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 text-white py-16 md:py-24">
                <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
                <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-white/5 blur-3xl" />

                <div className="container mx-auto px-4 max-w-4xl text-center relative z-10">
                    <div className="mb-5 flex justify-center">
                        <div className="h-16 w-16 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-sm border border-white/20">
                            <Scale className="h-8 w-8 text-white" />
                        </div>
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black leading-tight mb-4">
                        Terms & Conditions
                    </h1>
                    <p className="text-white/70 font-medium text-sm">
                        Effective Date: 15 February 2026 · Last Updated: 15 February 2026
                    </p>
                </div>
            </section>

            {/* ── Content ──────────────────────────────────────────────── */}
            <section className="py-12 md:py-20 bg-white">
                <div className="container mx-auto px-4 max-w-5xl">
                    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-10">

                        {/* ── Sidebar / TOC ─────────────────────────── */}
                        <aside className="hidden lg:block">
                            <div className="sticky top-24">
                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-4">
                                    Table of Contents
                                </p>
                                <nav className="space-y-1 max-h-[70vh] overflow-y-auto pr-2">
                                    {tocItems.map((item) => (
                                        <a
                                            key={item.id}
                                            href={`#${item.id}`}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all"
                                        >
                                            <span className="text-xs font-bold text-primary/50 w-6">{item.number}.</span>
                                            {item.label}
                                        </a>
                                    ))}
                                </nav>
                            </div>
                        </aside>

                        {/* ── Main Content ──────────────────────────── */}
                        <div className="space-y-12">

                            {/* Intro */}
                            <div className="pb-8 border-b border-border">
                                <p className="text-lg text-muted-foreground font-medium leading-relaxed">
                                    Welcome to DocNow Healthcare. These Terms & Conditions (&quot;Terms&quot;) govern your access to and use of our website, mobile application, and diagnostic services. By booking a test or using our platform, you agree to comply with these Terms.
                                </p>
                                <p className="mt-4 text-muted-foreground font-medium leading-relaxed">
                                    If you do not agree, please refrain from using our services.
                                </p>
                            </div>

                            {/* ── 1. About DocNow ──────────────────── */}
                            <TermsSection id="about" number="1" title="About DocNow Healthcare" icon={FileText}>
                                <p>
                                    DocNow Healthcare provides diagnostic laboratory services, including health checkups, pathology testing, preventive health packages, and home sample collection services through certified laboratory partners.
                                </p>
                                <Card className="p-5 bg-primary/5 border-primary/10">
                                    <p className="text-sm font-bold text-foreground">
                                        We act as a service facilitator connecting patients with accredited diagnostic laboratories.
                                    </p>
                                </Card>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 2. Eligibility ──────────────────── */}
                            <TermsSection id="eligibility" number="2" title="Eligibility" icon={UserCheck}>
                                <p>By using our services, you confirm that:</p>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        You are at least 18 years of age, or using the service under parental/guardian supervision.
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        The information provided by you is accurate and complete.
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        You are legally capable of entering into a binding agreement.
                                    </li>
                                </ul>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 3. Booking & Service ────────────── */}
                            <TermsSection id="booking-service" number="3" title="Booking & Service Terms" icon={CalendarCheck}>
                                <Card className="p-5 border-border/50">
                                    <h4 className="font-bold text-foreground mb-3">a) Test Booking</h4>
                                    <ul className="space-y-1.5 text-sm">
                                        <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> All bookings are subject to availability.</li>
                                        <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Confirmation is provided via SMS, email, or phone.</li>
                                        <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Certain tests may require prior medical prescriptions.</li>
                                    </ul>
                                </Card>

                                <Card className="p-5 border-border/50">
                                    <h4 className="font-bold text-foreground mb-3">b) Home Sample Collection</h4>
                                    <ul className="space-y-1.5 text-sm">
                                        <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Users must provide accurate address and contact details.</li>
                                        <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Our trained phlebotomists will collect samples at the scheduled time.</li>
                                        <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Delays due to unforeseen circumstances may occur.</li>
                                    </ul>
                                </Card>

                                <Card className="p-5 border-border/50">
                                    <h4 className="font-bold text-foreground mb-3">c) Preparation Guidelines</h4>
                                    <p className="text-sm">
                                        It is the user&apos;s responsibility to follow fasting or preparation instructions before the test. Incorrect preparation may affect test results.
                                    </p>
                                </Card>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 4. Payments & Pricing ───────────── */}
                            <TermsSection id="payments" number="4" title="Payments & Pricing" icon={CreditCard}>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        All prices are listed in INR (or applicable currency).
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Full payment must be made at the time of booking unless otherwise specified.
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        We use secure third-party payment gateways.
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        DocNow Healthcare does not store debit/credit card details.
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Prices are subject to change without prior notice; however, confirmed bookings will not be affected.
                                    </li>
                                </ul>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 5. Reports & Medical Disclaimer ─── */}
                            <TermsSection id="reports" number="5" title="Reports & Medical Disclaimer" icon={ClipboardList}>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Test reports are delivered digitally via email or platform login.
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Report timelines are indicative and may vary based on test complexity.
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Diagnostic reports are for informational purposes and must be interpreted by a qualified medical practitioner.
                                    </li>
                                </ul>
                                <Card className="p-5 bg-primary/5 border-primary/10">
                                    <p className="text-sm font-bold text-foreground">
                                        DocNow Healthcare does not provide medical diagnosis or treatment advice unless explicitly stated through licensed professionals.
                                    </p>
                                </Card>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 6. Cancellation & Refund ─────────── */}
                            <TermsSection id="cancellation" number="6" title="Cancellation & Refund Policy" icon={RotateCcw}>
                                <p>Cancellations must be requested prior to sample collection.</p>
                                <p>Refund eligibility depends on the service stage:</p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Card className="p-5 border-border/50 bg-green-50/50">
                                        <h4 className="font-bold text-green-800 mb-2 text-sm">Before Sample Collection</h4>
                                        <p className="text-sm text-green-700">
                                            Eligible for refund (processing fees may apply).
                                        </p>
                                    </Card>
                                    <Card className="p-5 border-border/50 bg-red-50/50">
                                        <h4 className="font-bold text-red-800 mb-2 text-sm">After Sample Collection</h4>
                                        <p className="text-sm text-red-700">
                                            Non-refundable.
                                        </p>
                                    </Card>
                                </div>

                                <p className="text-sm">Refund timelines depend on the payment provider.</p>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 7. Limitation of Liability ────────── */}
                            <TermsSection id="liability" number="7" title="Limitation of Liability" icon={AlertTriangle}>
                                <p>DocNow Healthcare shall not be liable for:</p>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Delays caused by external factors
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Incorrect information provided by the user
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Medical decisions taken based on reports without professional consultation
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Force majeure events (natural disasters, strikes, government restrictions, etc.)
                                    </li>
                                </ul>
                                <p className="text-sm font-semibold text-foreground">
                                    Our total liability, if any, shall not exceed the amount paid for the specific service.
                                </p>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 8. Privacy & Data ─────────────────── */}
                            <TermsSection id="privacy" number="8" title="Privacy & Data Protection" icon={Lock}>
                                <p>
                                    Your personal and medical data is handled in accordance with our{" "}
                                    <a href="/privacy" className="text-primary font-bold hover:underline">Privacy Policy</a>.
                                    By using our services, you consent to the collection and processing of your information as outlined therein.
                                </p>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 9. Intellectual Property ──────────── */}
                            <TermsSection id="ip" number="9" title="Intellectual Property" icon={Copyright}>
                                <p>
                                    All content on the DocNow Healthcare website, including logos, text, graphics, and design elements, is the intellectual property of DocNow Healthcare and may not be copied, reproduced, or distributed without prior written consent.
                                </p>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 10. Prohibited Use ────────────────── */}
                            <TermsSection id="prohibited" number="10" title="Prohibited Use" icon={Ban}>
                                <p>Users agree not to:</p>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                                        Provide false or misleading information
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                                        Attempt unauthorized access to the platform
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                                        Misuse services for unlawful purposes
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                                        Disrupt platform functionality
                                    </li>
                                </ul>
                                <p className="text-sm font-semibold text-foreground">
                                    Violation may result in suspension or termination of access.
                                </p>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 11. Third-Party Services ──────────── */}
                            <TermsSection id="third-party" number="11" title="Third-Party Services" icon={Handshake}>
                                <p>
                                    We may partner with accredited laboratories, logistics providers, and payment gateways. While we ensure quality standards, we are not responsible for third-party platform technical issues beyond our control.
                                </p>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 12. Amendments ────────────────────── */}
                            <TermsSection id="amendments" number="12" title="Amendments" icon={RefreshCw}>
                                <p>
                                    DocNow Healthcare reserves the right to update these Terms at any time. Continued use of the platform after updates constitutes acceptance of revised Terms.
                                </p>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 13. Governing Law ─────────────────── */}
                            <TermsSection id="governing-law" number="13" title="Governing Law & Jurisdiction" icon={Scale}>
                                <p>
                                    These Terms shall be governed by and interpreted in accordance with the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts located in <span className="font-bold text-foreground">Jaipur</span> only.
                                </p>
                            </TermsSection>

                            <hr className="border-border" />

                            {/* ── 14. Contact ───────────────────────── */}
                            <TermsSection id="contact" number="14" title="Contact Information" icon={Mail}>
                                <p>For any questions regarding these Terms, please contact:</p>
                                <Card className="p-6 border-border/50">
                                    <h4 className="font-black text-foreground text-lg mb-4">DocNow Healthcare</h4>
                                    <div className="space-y-3 text-sm">
                                        <p className="flex items-center gap-3">
                                            <Mail className="h-4 w-4 text-primary shrink-0" />
                                            <a href="mailto:harshagarwal@docnow.in" className="text-primary hover:underline font-semibold">harshagarwal@docnow.in</a>
                                        </p>
                                        <p className="flex items-center gap-3">
                                            <span className="text-primary shrink-0 text-base">📞</span>
                                            <span className="font-semibold text-foreground">+91 9469 089 089</span>
                                        </p>
                                        <p className="flex items-start gap-3">
                                            <span className="text-primary shrink-0 text-base mt-0.5">🏢</span>
                                            <span className="font-semibold text-foreground">Shop No 21, Chandpole Bazar, Jaipur</span>
                                        </p>
                                    </div>
                                </Card>
                            </TermsSection>

                            {/* ── Commitment Callout ─────────────────── */}
                            <div className="mt-4 rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-8 md:p-10 text-white text-center">
                                <div className="mb-4 flex justify-center">
                                    <div className="h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20">
                                        <Heart className="h-7 w-7 text-white" />
                                    </div>
                                </div>
                                <h3 className="text-2xl md:text-3xl font-black mb-3">A Commitment to Responsible Care</h3>
                                <p className="text-white/85 font-medium leading-relaxed max-w-xl mx-auto">
                                    At DocNow Healthcare, we are dedicated to maintaining transparency, compliance, and trust in every interaction.
                                </p>
                            </div>

                        </div>
                    </div>
                </div>
            </section>

            <Footer />
        </main>
    );
}
