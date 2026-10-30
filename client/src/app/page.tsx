/**
 * Homepage — Server Component
 *
 * DocNow's two co-equal pillars, video doctor consultations and lab tests at home, as instant
 * server HTML. Only data-driven parts ship JS: the hero search, live doctor fee and count, featured
 * doctors, product grids, camps, the callback form and the CMS hero carousel.
 */
import {
  Award,
  BadgeCheck,
  Beaker,
  Building2,
  Clock,
  FlaskConical,
  HeartPulse,
  Lock,
  Phone,
  Stethoscope,
  Workflow,
} from 'lucide-react';

import { Footer } from '@/components/Footer';
import { Card } from '@/components/ui';
import { CareLoop } from '@/components/home/CareLoop';
import { FamilyCareSpotlight } from '@/components/home/FamilyCareSpotlight';
import { FeaturedSpecialties } from '@/components/home/FeaturedSpecialties';
import { HeroDualPillars, HeroStatsCard } from '@/components/home/HeroDualPillars';

// Client Islands — only these ship JS to the browser
import { CallbackForm } from '@/components/home/CallbackForm';
import { FeaturedCamps } from '@/components/home/FeaturedCamps';
import { FeaturedDoctors } from '@/components/home/FeaturedDoctors';
import { FeaturedPackages, FeaturedTests } from '@/components/home/FeaturedProducts';
import { HeroCarousel } from '@/components/home/HeroCarousel';
import { RevealSection } from '@/components/home/RevealSection';
import { StickyMobileCTA } from '@/components/home/StickyMobileCTA';

// ────────────────────── Static Data (zero JS cost)
const whyChooseUs = [
  { icon: BadgeCheck, title: 'Verified Doctors', desc: 'Every doctor’s medical registration is checked before they can consult on DocNow.', color: 'bg-purple-50 text-purple-700', border: 'hover:border-purple-200' },
  { icon: Award, title: 'Certified Labs', desc: 'NABL & CAP accredited laboratories ensuring highest accuracy standards.', color: 'bg-amber-50 text-amber-600', border: 'hover:border-amber-200' },
  { icon: Clock, title: 'Fast Reports', desc: 'Get lab-certified digital reports within 24-48 hours of sample collection.', color: 'bg-blue-50 text-blue-600', border: 'hover:border-blue-200' },
  { icon: Lock, title: 'Data Privacy', desc: '100% encrypted and confidential. Your health data stays yours.', color: 'bg-green-50 text-green-600', border: 'hover:border-green-200' },
];

function SectionHeading({ badge, badgeIcon: BadgeIcon, badgeTone, title, subtitle }: {
  badge: string;
  badgeIcon: typeof Stethoscope;
  badgeTone: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-10 text-center md:mb-14">
      <div className={`mb-4 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 ${badgeTone}`}>
        <BadgeIcon className="h-4 w-4" aria-hidden />
        <span className="text-sm font-bold">{badge}</span>
      </div>
      <h2 className="mb-4 text-3xl font-black text-gray-900 md:text-5xl">{title}</h2>
      <p className="mx-auto max-w-2xl text-lg font-medium text-gray-500">{subtitle}</p>
    </div>
  );
}

// ────────────────────── Page (Server Component — NO "use client")
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-white pb-20 md:pb-0">

      {/* ═══════════ 1. DUAL-SERVICE HERO ═══════════ */}
      <section
        className="relative pb-16 md:pb-24 lg:pb-32"
        style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
      >
        {/* CMS slides on the right half of desktop; renders nothing when none are uploaded. */}
        <HeroCarousel />
        <HeroDualPillars />

        <div className="absolute -bottom-14 left-1/2 z-20 hidden w-[calc(100%-5rem)] max-w-4xl -translate-x-1/2 lg:block">
          <HeroStatsCard />
        </div>
        <div className="relative z-20 mx-4 -mb-4 lg:hidden">
          <HeroStatsCard />
        </div>
      </section>

      {/* ═══════════ 2. TOP SPECIALTIES ═══════════ */}
      <section className="bg-white pb-16 pt-24 md:pb-24 lg:pt-32">
        <RevealSection className="container mx-auto max-w-7xl px-4">
          <SectionHeading
            badge="Consult by Specialty"
            badgeIcon={Stethoscope}
            badgeTone="border-purple-100 bg-purple-50 text-purple-700"
            title="Top Medical Specialties"
            subtitle="Not sure who to see? Start with your symptoms and pick the right specialist."
          />
          <FeaturedSpecialties />
        </RevealSection>
      </section>

      {/* ═══════════ 3. FEATURED DOCTORS — Client Island ═══════════ */}
      <section className="bg-gradient-to-b from-gray-50/70 to-white py-16 md:py-24">
        <RevealSection className="container mx-auto max-w-7xl px-4">
          <SectionHeading
            badge="Verified Doctors"
            badgeIcon={BadgeCheck}
            badgeTone="border-emerald-100 bg-emerald-50 text-emerald-700"
            title="Consult Our Doctors"
            subtitle="Qualified doctors with checked medical registrations. See fees upfront and book a video slot."
          />
          <FeaturedDoctors />
        </RevealSection>
      </section>

      {/* ═══════════ 4. THE DOCNOW CARE LOOP ═══════════ */}
      <section className="bg-white py-16 md:py-24">
        <RevealSection className="container mx-auto max-w-7xl px-4">
          <SectionHeading
            badge="How DocNow Works"
            badgeIcon={Workflow}
            badgeTone="border-teal-100 bg-teal-50 text-teal-700"
            title="One Loop of Care, From Consult to Report"
            subtitle="See a doctor, get your prescription, give samples at home and get your reports, all in one place."
          />
          <CareLoop />
        </RevealSection>
      </section>

      {/* ═══════════ 5. ASSISTED FAMILY CARE ═══════════ */}
      <section className="bg-gradient-to-br from-[#F4F0FA] via-white to-[#F4F0FA] py-16 md:py-24">
        <RevealSection className="container mx-auto max-w-7xl px-4">
          <FamilyCareSpotlight />
        </RevealSection>
      </section>

      {/* ═══════════ 6. HEALTH PACKAGES & LAB TESTS — Client Islands ═══════════ */}
      <section className="bg-gradient-to-b from-white to-gray-50/50 py-16 md:py-24">
        <RevealSection className="container mx-auto max-w-7xl px-4">
          <SectionHeading
            badge="Curated by Experts"
            badgeIcon={FlaskConical}
            badgeTone="border-purple-100 bg-purple-50 text-purple-700"
            title="Popular Health Packages"
            subtitle="Comprehensive checkup packages designed by medical experts for complete health screening"
          />
          <FeaturedPackages />
        </RevealSection>
      </section>

      <section className="bg-gray-50/70 py-16 md:py-24">
        <RevealSection className="container mx-auto max-w-7xl px-4">
          <SectionHeading
            badge="Comprehensive Testing"
            badgeIcon={Beaker}
            badgeTone="border-blue-100 bg-blue-50 text-blue-700"
            title="Lab Tests & Profiles"
            subtitle="Precisely targeted diagnostics for specific health concerns"
          />
          <FeaturedTests />
        </RevealSection>
      </section>

      {/* ═══════════ HEALTH CAMPS — Client Island ═══════════ */}
      <section className="bg-white py-16 md:py-24">
        <RevealSection className="container mx-auto max-w-7xl px-4">
          <FeaturedCamps />
        </RevealSection>
      </section>

      {/* ═══════════ 7. TRUST & ACCREDITATION ═══════════ */}
      <section className="bg-white py-16 md:py-24">
        <RevealSection className="container mx-auto max-w-6xl px-4">
          <SectionHeading
            badge="Why DocNow"
            badgeIcon={HeartPulse}
            badgeTone="border-rose-100 bg-rose-50 text-rose-700"
            title="Why Choose DOCNOW?"
            subtitle="Trusted doctors and certified labs, with your privacy protected at every step"
          />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {whyChooseUs.map((feature) => (
              <Card
                key={feature.title}
                className={`group border-gray-100 p-6 text-center transition-all duration-300 hover:shadow-lg sm:p-8 ${feature.border}`}
              >
                <div className={`mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl ${feature.color} transition-transform group-hover:scale-110`}>
                  <feature.icon className="h-7 w-7" aria-hidden />
                </div>
                <h3 className="mb-2 text-lg font-bold text-gray-900">{feature.title}</h3>
                <p className="text-sm font-medium leading-relaxed text-gray-500">{feature.desc}</p>
              </Card>
            ))}
          </div>
        </RevealSection>
      </section>

      {/* ═══════════ 8. MEDICAL EXPERTS CALLBACK — Client Island for form ═══════════ */}
      <section className="bg-gradient-to-b from-gray-50/50 to-white py-16 md:py-24">
        <RevealSection className="container mx-auto max-w-3xl px-4">
          <Card className="overflow-hidden border-0 shadow-2xl shadow-purple-500/10">
            <div className="bg-gradient-to-r from-[#2d1670] to-[#4b2192] p-8 text-center text-white sm:p-10">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
                <Phone className="h-8 w-8" aria-hidden />
              </div>
              <h2 className="mb-3 text-2xl font-black sm:text-3xl">Need Help Choosing a Doctor or Test?</h2>
              <p className="mx-auto max-w-md font-medium text-white/70">
                Our medical experts will call you back within 15 minutes to help you pick the right specialist or tests.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-white/80">
                <Building2 className="h-4 w-4" aria-hidden />
                Managing employee testing at scale?
              </div>
            </div>
            <div className="p-6 sm:p-10">
              <CallbackForm />
            </div>
          </Card>
        </RevealSection>
      </section>

      <Footer />

      {/* ═══════════ STICKY MOBILE CTA — Client Island ═══════════ */}
      <StickyMobileCTA />
    </main>
  );
}
