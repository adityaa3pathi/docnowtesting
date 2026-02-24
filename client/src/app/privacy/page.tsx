"use client";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui";
import {
    Shield,
    FileText,
    Lock,
    Share2,
    Database,
    UserCheck,
    Cookie,
    Baby,
    RefreshCw,
    Mail,
    Heart,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  TABLE OF CONTENTS                                                  */
/* ------------------------------------------------------------------ */

const tocItems = [
    { id: "information-we-collect", label: "Information We Collect", number: "1" },
    { id: "how-we-use", label: "How We Use Your Information", number: "2" },
    { id: "data-security", label: "Data Security", number: "3" },
    { id: "data-sharing", label: "Data Sharing & Disclosure", number: "4" },
    { id: "data-retention", label: "Data Retention", number: "5" },
    { id: "your-rights", label: "Your Rights", number: "6" },
    { id: "cookies", label: "Cookies & Tracking", number: "7" },
    { id: "childrens-privacy", label: "Children's Privacy", number: "8" },
    { id: "changes", label: "Changes to This Policy", number: "9" },
    { id: "contact-us", label: "Contact Us", number: "10" },
];

/* ------------------------------------------------------------------ */
/*  SECTION COMPONENT                                                  */
/* ------------------------------------------------------------------ */

function PolicySection({
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

export default function PrivacyPolicyPage() {
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
                            <Shield className="h-8 w-8 text-white" />
                        </div>
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black leading-tight mb-4">
                        Privacy Policy
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
                                <nav className="space-y-1">
                                    {tocItems.map((item) => (
                                        <a
                                            key={item.id}
                                            href={`#${item.id}`}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all"
                                        >
                                            <span className="text-xs font-bold text-primary/50 w-5">{item.number}.</span>
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
                                    At DocNow Healthcare, we are committed to safeguarding your personal and medical information with the highest standards of confidentiality, integrity, and security. This Privacy Policy outlines how we collect, use, disclose, and protect your information when you use our diagnostic services, website, mobile platform, and related services.
                                </p>
                                <p className="mt-4 text-muted-foreground font-medium leading-relaxed">
                                    By accessing or using our services, you agree to the practices described in this Privacy Policy.
                                </p>
                            </div>

                            {/* ── 1. Information We Collect ─────────── */}
                            <PolicySection id="information-we-collect" number="1" title="Information We Collect" icon={FileText}>
                                <p>We may collect the following categories of information:</p>

                                <Card className="p-5 border-border/50">
                                    <h4 className="font-bold text-foreground mb-3">a) Personal Information</h4>
                                    <ul className="space-y-1.5 text-sm">
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Full Name</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Date of Birth</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Gender</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Contact Details (Phone Number, Email Address)</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Residential Address</li>
                                    </ul>
                                </Card>

                                <Card className="p-5 border-border/50">
                                    <h4 className="font-bold text-foreground mb-3">b) Health & Diagnostic Information</h4>
                                    <ul className="space-y-1.5 text-sm">
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Medical history (if voluntarily provided)</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Test prescriptions</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Laboratory reports and results</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Health-related declarations</li>
                                    </ul>
                                </Card>

                                <Card className="p-5 border-border/50">
                                    <h4 className="font-bold text-foreground mb-3">c) Payment Information</h4>
                                    <ul className="space-y-1.5 text-sm">
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Billing details</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Transaction information</li>
                                    </ul>
                                    <p className="mt-3 text-xs text-muted-foreground/80 italic">
                                        Note: Payment processing is handled through secure third-party payment gateways. We do not store card details.
                                    </p>
                                </Card>

                                <Card className="p-5 border-border/50">
                                    <h4 className="font-bold text-foreground mb-3">d) Technical Information</h4>
                                    <ul className="space-y-1.5 text-sm">
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> IP address</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Device information</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Browser type</li>
                                        <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" /> Cookies and usage analytics</li>
                                    </ul>
                                </Card>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 2. How We Use Your Information ────── */}
                            <PolicySection id="how-we-use" number="2" title="How We Use Your Information" icon={FileText}>
                                <p>We use your information for the following purposes:</p>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        To process and manage diagnostic test bookings
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        To coordinate home sample collection
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        To generate and deliver lab reports
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        To improve our services and customer experience
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        To comply with legal and regulatory obligations
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        To communicate important updates regarding your bookings or health reports
                                    </li>
                                </ul>
                                <Card className="p-5 bg-primary/5 border-primary/10">
                                    <p className="text-sm font-bold text-foreground">
                                        We do not sell, rent, or trade your personal information to third parties.
                                    </p>
                                </Card>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 3. Data Security ─────────────────── */}
                            <PolicySection id="data-security" number="3" title="Data Security" icon={Lock}>
                                <p>We implement industry-standard security measures to protect your information, including:</p>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Encrypted data transmission (SSL)
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Secure server infrastructure
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Role-based access controls
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Restricted internal access to sensitive medical data
                                    </li>
                                </ul>
                                <p className="text-sm italic text-muted-foreground/80">
                                    While we strive to protect your data, no digital platform can guarantee absolute security.
                                </p>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 4. Data Sharing ──────────────────── */}
                            <PolicySection id="data-sharing" number="4" title="Data Sharing & Disclosure" icon={Share2}>
                                <p>We may share your information only under the following circumstances:</p>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        With certified laboratory partners for the purpose of conducting tests
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        With trained phlebotomists for sample collection
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        With payment processors for transaction completion
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        When required by law, regulation, or court order
                                    </li>
                                </ul>
                                <p className="font-semibold text-foreground text-sm">
                                    All third-party partners are bound by strict confidentiality obligations.
                                </p>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 5. Data Retention ─────────────────── */}
                            <PolicySection id="data-retention" number="5" title="Data Retention" icon={Database}>
                                <p>We retain your information only for as long as necessary to:</p>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Provide diagnostic services
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Maintain medical records as required by applicable laws
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Resolve disputes and enforce agreements
                                    </li>
                                </ul>
                                <p>After the retention period, data is securely deleted or anonymized.</p>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 6. Your Rights ──────────────────── */}
                            <PolicySection id="your-rights" number="6" title="Your Rights" icon={UserCheck}>
                                <p>You may have the right to:</p>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Access your personal information
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Request correction of inaccurate data
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Request deletion (subject to legal obligations)
                                    </li>
                                    <li className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        Withdraw consent where applicable
                                    </li>
                                </ul>
                                <Card className="p-5 bg-primary/5 border-primary/10">
                                    <p className="text-sm">
                                        To exercise these rights, please contact us at:{" "}
                                        <a href="mailto:harshagarwal@docnow.in" className="font-bold text-primary hover:underline">
                                            harshagarwal@docnow.in
                                        </a>
                                    </p>
                                </Card>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 7. Cookies ──────────────────────── */}
                            <PolicySection id="cookies" number="7" title="Cookies & Tracking Technologies" icon={Cookie}>
                                <p>
                                    We may use cookies and similar technologies to enhance user experience, analyze traffic, and improve platform functionality. You can manage cookie preferences through your browser settings.
                                </p>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 8. Children's Privacy ────────────── */}
                            <PolicySection id="childrens-privacy" number="8" title="Children's Privacy" icon={Baby}>
                                <p>
                                    Our services are not directed toward individuals under the age of 18 without parental or guardian consent. We do not knowingly collect personal information from minors without proper authorization.
                                </p>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 9. Changes ─────────────────────── */}
                            <PolicySection id="changes" number="9" title="Changes to This Privacy Policy" icon={RefreshCw}>
                                <p>
                                    DocNow Healthcare reserves the right to update this Privacy Policy periodically. Any changes will be posted on this page with an updated effective date.
                                </p>
                            </PolicySection>

                            <hr className="border-border" />

                            {/* ── 10. Contact Us ─────────────────── */}
                            <PolicySection id="contact-us" number="10" title="Contact Us" icon={Mail}>
                                <p>
                                    If you have any questions or concerns regarding this Privacy Policy or our data practices, please contact:
                                </p>
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
                            </PolicySection>

                            {/* ── Our Commitment Callout ─────────── */}
                            <div className="mt-4 rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-8 md:p-10 text-white text-center">
                                <div className="mb-4 flex justify-center">
                                    <div className="h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20">
                                        <Heart className="h-7 w-7 text-white" />
                                    </div>
                                </div>
                                <h3 className="text-2xl md:text-3xl font-black mb-3">Our Commitment</h3>
                                <p className="text-white/85 font-medium leading-relaxed max-w-xl mx-auto">
                                    At DocNow Healthcare, privacy is not just a policy — it is a responsibility.
                                    We treat your health information with the discretion and care it deserves.
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
