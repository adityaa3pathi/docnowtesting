/**
 * Homepage hero (Server Component): one promise, two co-equal ways in — a video doctor consult
 * and lab tests at home — plus one search box for both. Only the search box, the live fee and the
 * live doctor count are client islands.
 */
import Link from 'next/link';
import { ArrowRight, BadgeCheck, FileText, FlaskConical, House, Lock, ShieldCheck, Star, Stethoscope, Users, Video, Clock } from 'lucide-react';
import { HOME_SPECIALTIES, specialtyHref } from '@/lib/home/specialties';
import { HeroSearch } from './HeroSearch';
import { ConsultFromFee, DoctorCountStat } from './LiveDoctorStats';

export const HERO_HEADLINE = 'Complete Healthcare, Delivered Home';
export const HERO_SUBHEADLINE = 'Consult certified, verified doctors on video, or get NABL-accredited lab tests collected at your doorstep.';

const QUICK_SEARCHES = [
    { label: 'Fever', href: specialtyHref(HOME_SPECIALTIES[0].key) },
    { label: 'Full Body Checkup', href: '/search?q=Full%20Body' },
    { label: 'Skin & Hair', href: specialtyHref(HOME_SPECIALTIES[1].key) },
    { label: 'Diabetes', href: '/search?q=Diabetes' },
    { label: 'Thyroid', href: '/search?q=Thyroid' },
];

export function HeroDualPillars() {
    return (
        <div className="relative z-10 mx-auto max-w-[1380px] px-4 pb-10 pt-8 sm:px-6 lg:px-16 lg:pb-20 lg:pt-14">
            <div className="lg:w-[55%] lg:pr-8">
                <h1 className="font-inter text-[2rem] font-black leading-[1.1] text-white sm:text-5xl lg:text-[54px]">
                    Complete Healthcare,{' '}
                    <span className="bg-gradient-to-r from-white to-purple-200 bg-clip-text text-transparent">Delivered Home</span>
                    <span className="mt-3 block text-lg font-bold text-white/85 sm:text-2xl">Consult Top Doctors &amp; Book Lab Tests</span>
                </h1>
                <p className="mt-4 max-w-xl font-inter text-base leading-relaxed text-white/80 md:text-lg">{HERO_SUBHEADLINE}</p>

                <div className="mt-7 max-w-xl">
                    <HeroSearch />
                    <div className="mt-3 flex flex-wrap gap-2" aria-label="Popular searches">
                        {QUICK_SEARCHES.map((q) => (
                            <Link key={q.label} href={q.href} className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20">
                                {q.label}
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Pillar 1: video doctor consultation */}
                    <section data-testid="hero-card-consult" aria-labelledby="hero-consult-title" className="relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-[#4b2192] to-[#36166b] p-5 text-white shadow-2xl ring-1 ring-white/15">
                        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
                            <span className="relative flex h-2.5 w-2.5" aria-hidden>
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                            </span>
                            Verified Doctors · Online Video Consult
                        </span>
                        <div className="mt-4 flex items-center gap-3">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-primary"><Stethoscope className="h-6 w-6" aria-hidden /></span>
                            <h2 id="hero-consult-title" className="text-xl font-extrabold leading-tight">Video Doctor Consultation</h2>
                        </div>
                        <ul className="mt-3 space-y-1.5 text-sm text-white/85">
                            <li className="flex items-center gap-2"><Video className="h-4 w-4 shrink-0" aria-hidden /> Book a slot, consult on HD video</li>
                            <li className="flex items-center gap-2"><FileText className="h-4 w-4 shrink-0" aria-hidden /> Digital prescription</li>
                            <li className="flex items-center gap-2"><Lock className="h-4 w-4 shrink-0" aria-hidden /> Private &amp; confidential</li>
                        </ul>
                        <Link href="/consult" data-testid="hero-cta-consult" className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-center text-[15px] font-extrabold text-primary shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]">
                            <span>Consult a Doctor<ConsultFromFee /></span>
                            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                        </Link>
                    </section>

                    {/* Pillar 2: lab tests at home */}
                    <section data-testid="hero-card-tests" aria-labelledby="hero-tests-title" className="relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 to-emerald-700 p-5 text-white shadow-2xl ring-1 ring-white/15">
                        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
                            <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-hidden /> NABL &amp; CAP Accredited Labs
                        </span>
                        <div className="mt-4 flex items-center gap-3">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-teal-700"><FlaskConical className="h-6 w-6" aria-hidden /></span>
                            <h2 id="hero-tests-title" className="text-xl font-extrabold leading-tight">At-Home Lab Tests</h2>
                        </div>
                        <ul className="mt-3 space-y-1.5 text-sm text-white/85">
                            <li className="flex items-center gap-2"><House className="h-4 w-4 shrink-0" aria-hidden /> Free home sample collection</li>
                            <li className="flex items-center gap-2"><Clock className="h-4 w-4 shrink-0" aria-hidden /> Digital reports in 24h</li>
                            <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden /> Experienced phlebotomists</li>
                        </ul>
                        <Link href="/search?type=TEST" data-testid="hero-cta-tests" className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-center text-[15px] font-extrabold text-teal-800 shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]">
                            Book Lab Tests at Home <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                        </Link>
                    </section>
                </div>
            </div>
        </div>
    );
}

const STATS = [
    { icon: Users, tint: 'bg-purple-50 text-purple-600', value: '50K+', label: 'Happy Patients' },
    { icon: BadgeCheck, tint: 'bg-emerald-50 text-emerald-600', value: null, label: 'Verified Doctors' },
    { icon: FlaskConical, tint: 'bg-teal-50 text-teal-600', value: '200+', label: 'Lab Tests & Packages' },
    { icon: Clock, tint: 'bg-orange-50 text-orange-500', value: '24h', label: 'Report Delivery' },
] as const;

/** Four balanced KPIs. The doctor count is live, so the page never claims more doctors than it lists. */
export function HeroStatsCard() {
    return (
        <div className="rounded-2xl bg-white px-4 py-6 shadow-[0_9px_30px_rgba(0,0,0,0.18)] md:px-10">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-4">
                {STATS.map((s) => (
                    <div key={s.label} className="flex flex-col items-center gap-2 text-center">
                        <span className={`flex h-11 w-11 items-center justify-center rounded-full ${s.tint}`}><s.icon className="h-6 w-6" aria-hidden /></span>
                        <span className="font-inter text-2xl font-black text-gray-900 md:text-3xl">{s.value ?? <DoctorCountStat />}</span>
                        <span className="font-inter text-xs font-semibold uppercase tracking-wide text-gray-400">{s.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
