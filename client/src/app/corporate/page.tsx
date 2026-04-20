'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, ClipboardCheck, Factory, HeartPulse, Loader2, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { Footer } from '@/components/Footer';
import { Button, Card, Input } from '@/components/ui';
import api from '@/lib/api';

const companySizes = ['1-50', '51-200', '201-1000', '1000+'];
const requirementTypes = [
    'Employee health checkups',
    'Onsite health camps',
    'Pre-employment testing',
    'Recurring diagnostics partnership',
    'Custom requirement',
];

const useCases = [
    {
        icon: HeartPulse,
        title: 'Employee wellness programs',
        description: 'Annual health packages, preventive screening, and workforce wellbeing programs delivered at scale.',
    },
    {
        icon: Factory,
        title: 'Onsite camps',
        description: 'Coordinate sample collection or health camps directly at office sites, plants, or distributed campuses.',
    },
    {
        icon: ClipboardCheck,
        title: 'Pre-employment testing',
        description: 'Streamline diagnostic workflows for hiring, joining formalities, and operational fitness checks.',
    },
    {
        icon: Stethoscope,
        title: 'Recurring diagnostics partnership',
        description: 'Set up a long-term diagnostics operating model with dedicated support and reporting.',
    },
];

const faqs = [
    {
        question: 'What kinds of organizations can work with DocNow?',
        answer: 'We support startups, SMBs, large enterprises, schools, manufacturing units, and distributed teams that need employee diagnostic services in bulk.',
    },
    {
        question: 'Do you support both camps and recurring programs?',
        answer: 'Yes. We can help with one-time employee testing drives as well as ongoing diagnostics partnerships.',
    },
    {
        question: 'How quickly does your corporate team respond?',
        answer: 'For qualified leads, our corporate partnerships team typically responds within one business day.',
    },
];

export default function CorporatePage() {
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [form, setForm] = useState({
        contactName: '',
        workEmail: '',
        mobile: '',
        companyName: '',
        city: '',
        companySize: companySizes[0],
        requirementType: requirementTypes[0],
        summary: '',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            const res = await api.post('/corporate-inquiries', {
                ...form,
                mobile: form.mobile.replace(/\D/g, '').slice(0, 10),
            });
            toast.success(res.data?.message || 'Thanks, our corporate partnerships team will reach out shortly.');
            setSubmitted(true);
        } catch (error: any) {
            console.error('Corporate inquiry error:', error);
            toast.error(error.response?.data?.error || error.message || 'We could not submit your request right now.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="min-h-screen bg-[#faf8ff]">

            <section className="relative overflow-hidden border-b border-purple-100 bg-[radial-gradient(circle_at_top_left,_rgba(139,92,246,0.18),_transparent_38%),linear-gradient(180deg,#ffffff_0%,#f7f2ff_100%)]">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
                    <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-white/80 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-[#4b2192]">
                                <Building2 className="h-4 w-4" />
                                Corporate Partnerships
                            </div>
                            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                                Bulk employee testing and corporate diagnostics partnerships
                            </h1>
                            <p className="mt-5 max-w-2xl text-lg font-medium leading-8 text-slate-600">
                                Build a reliable diagnostics program for your workforce with home collection, onsite camps,
                                recurring testing coordination, and dedicated partnership support.
                            </p>

                            <div className="mt-8 grid gap-4 sm:grid-cols-3">
                                <Card className="border-purple-100 bg-white/80 p-4 shadow-sm">
                                    <Users className="h-5 w-5 text-[#4b2192]" />
                                    <p className="mt-3 text-sm font-bold text-slate-900">Bulk coordination</p>
                                    <p className="mt-1 text-sm text-slate-600">Designed for HR and ops teams managing employee testing at scale.</p>
                                </Card>
                                <Card className="border-purple-100 bg-white/80 p-4 shadow-sm">
                                    <ShieldCheck className="h-5 w-5 text-[#4b2192]" />
                                    <p className="mt-3 text-sm font-bold text-slate-900">Dedicated support</p>
                                    <p className="mt-1 text-sm text-slate-600">A corporate team to help with planning, rollout, and operational follow-through.</p>
                                </Card>
                                <Card className="border-purple-100 bg-white/80 p-4 shadow-sm">
                                    <CheckCircle2 className="h-5 w-5 text-[#4b2192]" />
                                    <p className="mt-3 text-sm font-bold text-slate-900">Actionable reporting</p>
                                    <p className="mt-1 text-sm text-slate-600">Structured reporting and program visibility for repeat diagnostics initiatives.</p>
                                </Card>
                            </div>
                        </div>

                        <Card className="border-purple-100 bg-white/95 p-6 shadow-2xl shadow-purple-500/10 sm:p-8">
                            {submitted ? (
                                <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                                        <CheckCircle2 className="h-8 w-8 text-green-600" />
                                    </div>
                                    <h2 className="mt-6 text-2xl font-black text-slate-950">Thanks, we’ve received your inquiry</h2>
                                    <p className="mt-3 max-w-md text-base leading-7 text-slate-600">
                                        Our corporate partnerships team will review your requirements and reach out shortly.
                                    </p>
                                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                                        <Button onClick={() => setSubmitted(false)}>Submit another inquiry</Button>
                                        <Link href="/">
                                            <Button variant="outline">Back to home</Button>
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <p className="text-sm font-black uppercase tracking-[0.2em] text-[#4b2192]">Talk to our team</p>
                                        <h2 className="mt-2 text-2xl font-black text-slate-950">Tell us about your corporate requirement</h2>
                                        <p className="mt-2 text-sm text-slate-600">
                                            We usually respond within one business day with the right next step for your team.
                                        </p>
                                    </div>

                                    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                                        <div>
                                            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Contact person name</label>
                                            <Input
                                                value={form.contactName}
                                                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                                                placeholder="Enter the primary SPOC name"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Work email</label>
                                            <Input
                                                type="email"
                                                value={form.workEmail}
                                                onChange={(e) => setForm({ ...form, workEmail: e.target.value })}
                                                placeholder="name@company.com"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Mobile number</label>
                                            <Input
                                                value={form.mobile}
                                                onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                                                placeholder="10-digit mobile number"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Company name</label>
                                            <Input
                                                value={form.companyName}
                                                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                                                placeholder="Enter your organization name"
                                                required
                                            />
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div>
                                                <label className="mb-1.5 block text-sm font-semibold text-slate-700">City / primary service location</label>
                                                <Input
                                                    value={form.city}
                                                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                                                    placeholder="e.g. Gurgaon"
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Company size</label>
                                                <select
                                                    value={form.companySize}
                                                    onChange={(e) => setForm({ ...form, companySize: e.target.value })}
                                                    className="h-12 w-full rounded-xl border border-border bg-input px-4 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                                    required
                                                >
                                                    {companySizes.map((size) => <option key={size} value={size}>{size}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Requirement type</label>
                                            <select
                                                value={form.requirementType}
                                                onChange={(e) => setForm({ ...form, requirementType: e.target.value })}
                                                className="h-12 w-full rounded-xl border border-border bg-input px-4 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                                required
                                            >
                                                {requirementTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Requirement summary</label>
                                            <textarea
                                                value={form.summary}
                                                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                                                placeholder="Tell us about employee count, timeline, locations, frequency, or any special needs."
                                                rows={5}
                                                className="w-full rounded-2xl border border-border bg-input px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                                            />
                                        </div>

                                        <Button size="lg" className="w-full py-6 text-base" disabled={submitting}>
                                            {submitting ? (
                                                <>
                                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                                    Submitting inquiry...
                                                </>
                                            ) : (
                                                'Submit corporate inquiry'
                                            )}
                                        </Button>
                                        <p className="text-xs font-medium leading-6 text-slate-500">
                                            By submitting this form, you agree to our <Link href="/privacy" className="text-[#4b2192] underline">Privacy Policy</Link>.
                                        </p>
                                    </form>
                                </>
                            )}
                        </Card>
                    </div>
                </div>
            </section>

            <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
                <div className="mb-8 max-w-2xl">
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-[#4b2192]">Common use cases</p>
                    <h2 className="mt-3 text-3xl font-black text-slate-950">How teams typically work with us</h2>
                    <p className="mt-3 text-base leading-7 text-slate-600">
                        From one-time employee health drives to recurring diagnostic programs, we help teams design the right operating model.
                    </p>
                </div>
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
                    {useCases.map((item) => {
                        const Icon = item.icon;
                        return (
                            <Card key={item.title} className="border-purple-100 p-6 shadow-sm">
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-50 text-[#4b2192]">
                                    <Icon className="h-6 w-6" />
                                </div>
                                <h3 className="mt-5 text-lg font-black text-slate-900">{item.title}</h3>
                                <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                            </Card>
                        );
                    })}
                </div>
            </section>

            <section className="border-t border-purple-100 bg-white">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
                    <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
                        <div>
                            <p className="text-sm font-black uppercase tracking-[0.2em] text-[#4b2192]">Why teams choose DocNow</p>
                            <h2 className="mt-3 text-3xl font-black text-slate-950">Built for operationally demanding diagnostic programs</h2>
                            <div className="mt-6 space-y-4 text-sm leading-7 text-slate-600">
                                <p>Coordinate employee testing without forcing HR, admin, or operations teams to manually stitch together partner follow-ups.</p>
                                <p>Use one platform for planning, sample collection coordination, report visibility, and diagnostics support across cities and teams.</p>
                                <p>Whether you need a one-time camp or a long-term diagnostics partner, we help translate requirements into a manageable execution plan.</p>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {faqs.map((faq) => (
                                <Card key={faq.question} className="border-purple-100 p-6 shadow-sm">
                                    <h3 className="text-lg font-black text-slate-900">{faq.question}</h3>
                                    <p className="mt-2 text-sm leading-6 text-slate-600">{faq.answer}</p>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <Footer />
        </main>
    );
}
