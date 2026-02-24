"use client";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui";
import {
    Heart,
    Activity,
    Beaker,
    Stethoscope,
    Users,
    Home,
    Building2,
    ShieldCheck,
    CalendarCheck,
    UserCheck,
    FileText,
    IndianRupee,
    Headphones,
    Eye,
    Target,
    Sparkles,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  DATA — easy to edit in one place                                   */
/* ------------------------------------------------------------------ */

const expertiseItems = [
    {
        icon: Activity,
        label: "Comprehensive Preventive Health Checkups",
    },
    {
        icon: Beaker,
        label: "Advanced Pathology & Biochemistry Testing",
    },
    {
        icon: Stethoscope,
        label: "Hormone & Thyroid Panels",
    },
    {
        icon: Heart,
        label: "Diabetes & Cardiac Risk Profiling",
    },
    {
        icon: Users,
        label: "Specialized Women's & Men's Health Packages",
    },
    {
        icon: Building2,
        label: "Corporate Wellness Screening Programs",
    },
    {
        icon: Home,
        label: "Premium Home Sample Collection Services",
    },
];

const innovationItems = [
    {
        icon: CalendarCheck,
        title: "Effortless Online Booking",
        description:
            "Book diagnostic tests in a few taps — anytime, anywhere, from any device.",
    },
    {
        icon: UserCheck,
        title: "Trained Phlebotomists",
        description:
            "Scheduled home sample collection by certified, experienced professionals.",
    },
    {
        icon: FileText,
        title: "Secure Digital Reports",
        description:
            "Access your reports online with end-to-end encryption and data privacy.",
    },
    {
        icon: IndianRupee,
        title: "Transparent Pricing",
        description:
            "No hidden fees. Clear pricing so you know exactly what you're paying for.",
    },
    {
        icon: Headphones,
        title: "Dedicated Customer Support",
        description:
            "Our care team is always ready to assist you at every step of your journey.",
    },
];

/* ------------------------------------------------------------------ */
/*  PAGE COMPONENT                                                     */
/* ------------------------------------------------------------------ */

export default function AboutPage() {
    return (
        <main className="flex flex-col min-h-screen">
            <Header />

            {/* ── Hero Section ─────────────────────────────────────────── */}
            <section className="relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 text-white py-20 md:py-28">
                {/* decorative blobs */}
                <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
                <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-white/5 blur-3xl" />

                <div className="container mx-auto px-4 max-w-4xl text-center relative z-10">
                    <p className="mb-4 text-xs font-black uppercase tracking-[0.3em] text-white/60">
                        About DocNow Healthcare
                    </p>
                    <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6">
                        Redefining Diagnostic{" "}
                        <span className="text-white/80 italic">Excellence</span>
                    </h1>
                    <p className="text-lg md:text-xl text-white/85 font-medium max-w-2xl mx-auto leading-relaxed">
                        At DocNow Healthcare, we are committed to elevating the standards of
                        diagnostic care through precision, technology, and uncompromising
                        quality. We believe that accurate diagnostics form the foundation of
                        effective healthcare, and every report we deliver carries our promise
                        of reliability and integrity.
                    </p>
                </div>
            </section>

            {/* ── Who We Are ───────────────────────────────────────────── */}
            <section className="py-16 md:py-24 bg-white">
                <div className="container mx-auto px-4 max-w-5xl">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl md:text-5xl font-black text-foreground mb-4">
                            Who We Are
                        </h2>
                        <div className="mx-auto h-1 w-16 rounded-full bg-primary/30" />
                    </div>
                    <div className="max-w-3xl mx-auto space-y-6 text-center">
                        <p className="text-lg text-muted-foreground font-medium leading-relaxed">
                            DocNow Healthcare is a next-generation diagnostic services platform
                            designed to deliver world-class laboratory testing with unmatched
                            convenience. By integrating certified laboratory networks, advanced
                            diagnostic technologies, and a streamlined digital interface, we
                            provide a comprehensive and dependable healthcare experience.
                        </p>
                        <p className="text-lg text-muted-foreground font-medium leading-relaxed">
                            Our approach combines medical expertise with operational excellence
                            to ensure every test meets the highest standards of accuracy and
                            quality control.
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Our Expertise ────────────────────────────────────────── */}
            <section className="py-16 md:py-24 bg-accent/30">
                <div className="container mx-auto px-4 max-w-6xl">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-5xl font-black text-foreground mb-4">
                            Our Expertise
                        </h2>
                        <p className="text-lg text-muted-foreground font-medium">
                            We offer a wide spectrum of diagnostic services
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {expertiseItems.map((item, i) => (
                            <Card
                                key={i}
                                className="flex items-center gap-4 p-6 bg-white border-border/50 hover:shadow-lg hover:shadow-primary/5 transition-all"
                            >
                                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent">
                                    <item.icon className="h-7 w-7 text-primary" />
                                </div>
                                <span className="font-bold text-foreground">{item.label}</span>
                            </Card>
                        ))}
                    </div>

                    <p className="mt-10 text-center text-muted-foreground font-medium">
                        Each service is designed with{" "}
                        <span className="font-bold text-foreground">
                            precision, confidentiality, and efficiency
                        </span>{" "}
                        at its core.
                    </p>
                </div>
            </section>

            {/* ── Commitment to Quality ────────────────────────────────── */}
            <section className="py-16 md:py-24 bg-white">
                <div className="container mx-auto px-4 max-w-5xl">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                        {/* icon block */}
                        <div className="flex justify-center">
                            <div className="h-48 w-48 md:h-64 md:w-64 rounded-3xl bg-accent flex items-center justify-center">
                                <ShieldCheck className="h-24 w-24 md:h-32 md:w-32 text-primary/60" />
                            </div>
                        </div>

                        {/* text */}
                        <div>
                            <h2 className="text-3xl md:text-5xl font-black text-foreground mb-6">
                                Our Commitment to Quality
                            </h2>
                            <p className="text-lg text-muted-foreground font-medium leading-relaxed mb-4">
                                Excellence in diagnostics requires more than technology — it
                                demands discipline, protocol, and accountability. We collaborate
                                with accredited laboratories, follow stringent quality assurance
                                processes, and ensure every sample is handled with meticulous
                                care.
                            </p>
                            <p className="text-lg text-muted-foreground font-medium leading-relaxed">
                                From sample collection to report delivery, our systems are
                                designed to maintain{" "}
                                <span className="font-bold text-foreground">
                                    accuracy, consistency, and data security
                                </span>
                                .
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Patient-Centric Innovation ───────────────────────────── */}
            <section className="py-16 md:py-24 bg-accent/30">
                <div className="container mx-auto px-4 max-w-6xl">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-5xl font-black text-foreground mb-4">
                            Patient-Centric Innovation
                        </h2>
                        <p className="text-lg text-muted-foreground font-medium max-w-2xl mx-auto">
                            At DocNow Healthcare, innovation is not just about digital
                            convenience — it's about enhancing the overall healthcare journey.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                        {innovationItems.map((item, i) => (
                            <Card
                                key={i}
                                className="p-8 bg-white border-border/50 hover:shadow-xl hover:shadow-primary/5 transition-all group"
                            >
                                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent group-hover:bg-primary/10 transition-colors">
                                    <item.icon className="h-7 w-7 text-primary" />
                                </div>
                                <h3 className="text-xl font-bold text-foreground mb-2">
                                    {item.title}
                                </h3>
                                <p className="text-muted-foreground font-medium leading-relaxed">
                                    {item.description}
                                </p>
                            </Card>
                        ))}
                    </div>

                    <p className="mt-10 text-center text-muted-foreground font-medium">
                        We focus on creating a{" "}
                        <span className="font-bold text-foreground">
                            refined and reassuring experience
                        </span>{" "}
                        at every touchpoint.
                    </p>
                </div>
            </section>

            {/* ── Vision & Mission ─────────────────────────────────────── */}
            <section className="py-16 md:py-24 bg-white">
                <div className="container mx-auto px-4 max-w-5xl">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Vision */}
                        <Card className="p-10 border-2 border-primary/10">
                            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                                <Eye className="h-8 w-8 text-primary" />
                            </div>
                            <h3 className="text-2xl font-black text-foreground mb-4">
                                Our Vision
                            </h3>
                            <p className="text-muted-foreground font-medium leading-relaxed">
                                To become a trusted leader in diagnostic healthcare by setting
                                new benchmarks in accuracy, accessibility, and patient
                                experience.
                            </p>
                        </Card>

                        {/* Mission */}
                        <Card className="p-10 border-2 border-primary/10">
                            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                                <Target className="h-8 w-8 text-primary" />
                            </div>
                            <h3 className="text-2xl font-black text-foreground mb-4">
                                Our Mission
                            </h3>
                            <p className="text-muted-foreground font-medium leading-relaxed">
                                To deliver precise, timely, and affordable diagnostic solutions
                                while maintaining the highest standards of clinical integrity
                                and service excellence.
                            </p>
                        </Card>
                    </div>
                </div>
            </section>

            {/* ── The DocNow Promise ───────────────────────────────────── */}
            <section className="py-16 md:py-24 bg-gradient-to-br from-primary to-primary/80 text-white">
                <div className="container mx-auto px-4 max-w-4xl text-center">
                    <div className="mb-8 flex justify-center">
                        <div className="h-20 w-20 rounded-3xl bg-white/10 flex items-center justify-center backdrop-blur-sm border border-white/20">
                            <Sparkles className="h-10 w-10 text-white" />
                        </div>
                    </div>
                    <h2 className="text-3xl md:text-5xl font-black mb-6">
                        The DocNow Promise
                    </h2>
                    <p className="text-lg md:text-xl text-white/85 font-medium leading-relaxed max-w-2xl mx-auto mb-8">
                        At DocNow Healthcare, we understand that every diagnostic report
                        influences important medical decisions. That is why we operate with
                        responsibility, precision, and compassion.
                    </p>
                    <div className="inline-block bg-white/10 rounded-2xl border border-white/20 px-8 py-6 backdrop-blur-sm">
                        <p className="text-xl md:text-2xl font-bold text-white/90 italic">
                            We don't just provide test results.
                        </p>
                        <p className="text-2xl md:text-3xl font-black mt-2">
                            We provide{" "}
                            <span className="text-white/80">clarity, confidence, and care.</span>
                        </p>
                    </div>
                </div>
            </section>

            <Footer />
        </main>
    );
}
