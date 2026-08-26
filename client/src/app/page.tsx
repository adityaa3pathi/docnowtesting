/**
 * Homepage — Server Component
 * 
 * Static sections (hero, how-it-works, why-us, stats, footer) are rendered as
 * instant HTML on the server. Only the dynamic product grids, callback form,
 * and CTA buttons are hydrated as small client islands.
 */
import Link from 'next/link';
import {
  Search,
  Award,
  Clock,
  Shield,
  Users,
  Phone,
  Beaker,
  Truck,
  Building2,
  FileCheck,
  FlaskConical,
  Star,
  Lock,
} from 'lucide-react';

import { Footer } from '@/components/Footer';
import { Card } from '@/components/ui';

// Client Islands — only these ship JS to the browser
import { FeaturedPackages, FeaturedTests } from '@/components/home/FeaturedProducts';
import { FeaturedCamps } from '@/components/home/FeaturedCamps';
import { CallbackForm } from '@/components/home/CallbackForm';
import { HeroCarousel } from '@/components/home/HeroCarousel';
import { RevealSection } from '@/components/home/RevealSection';
import { StickyMobileCTA } from '@/components/home/StickyMobileCTA';

const howItWorks = [
  { step: '01', title: 'Choose Your Test', description: 'Browse our catalog and select the tests or health packages you need.', icon: Search, color: 'from-purple-500 to-indigo-600' },
  { step: '02', title: 'Schedule Collection', description: 'Pick a convenient date, time, and address for home sample collection.', icon: Clock, color: 'from-fuchsia-500 to-purple-600' },
  { step: '03', title: 'Get Digital Reports', description: 'Receive accurate, lab-certified digital reports within 24-48 hours.', icon: FileCheck, color: 'from-pink-500 to-fuchsia-600' },
];

const whyChooseUs = [
  { icon: Award, title: 'Certified Labs', desc: 'NABL & CAP accredited laboratories ensuring highest accuracy standards.', color: 'bg-amber-50 text-amber-600', border: 'hover:border-amber-200' },
  { icon: Clock, title: 'Fast Reports', desc: 'Get lab-certified digital reports within 24-48 hours of sample collection.', color: 'bg-blue-50 text-blue-600', border: 'hover:border-blue-200' },
  { icon: Lock, title: 'Data Privacy', desc: '100% encrypted and confidential. Your health data stays yours.', color: 'bg-green-50 text-green-600', border: 'hover:border-green-200' },
  { icon: Star, title: 'Expert Team', desc: 'Experienced phlebotomists and healthcare professionals at your doorstep.', color: 'bg-purple-50 text-purple-600', border: 'hover:border-purple-200' },
];

// ────────────────────── Page (Server Component — NO "use client")
export default function Home() {
  return (
    <main className="flex flex-col min-h-screen bg-white pb-20 md:pb-0 overflow-x-hidden">

      {/* ═══════════ HERO CAROUSEL ═══════════ */}
      <HeroCarousel />


      {/* ═══════════ TRUST / SOCIAL PROOF ═══════════ */}


      {/* ═══════════ HEALTH PACKAGES — Client Island ═══════════ */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-white to-gray-50/50">
        <RevealSection className="container mx-auto px-4 max-w-7xl">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-50 border border-purple-100 mb-4">
              <FlaskConical className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-bold text-purple-700">Curated by Experts</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-gray-900 mb-4">
              Popular Health Packages
            </h2>
            <p className="text-lg text-gray-500 font-medium max-w-2xl mx-auto">
              Comprehensive checkup packages designed by medical experts for complete health screening
            </p>
          </div>
          <FeaturedPackages />
        </RevealSection>
      </section>

      {/* ═══════════ HOW IT WORKS — pure server HTML ═══════════ */}
      <section className="py-16 md:py-24 bg-white">
        <RevealSection className="container mx-auto px-4 max-w-6xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-black text-gray-900 mb-4">
              How It Works
            </h2>
            <p className="text-lg text-gray-500 font-medium">
              Book a test in 3 easy steps
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-4 relative">
            <div className="hidden md:block absolute top-16 left-[20%] right-[20%] h-0.5 bg-gradient-to-r from-purple-200 via-purple-400 to-purple-200" />
            {howItWorks.map((item) => (
              <div key={item.step} className="text-center relative z-10 group">
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${item.color} shadow-lg mb-6 group-hover:scale-110 transition-transform`}>
                  <item.icon className="w-7 h-7 text-white" />
                </div>
                <div className="text-xs font-black text-purple-400 uppercase tracking-[0.2em] mb-2">Step {item.step}</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{item.title}</h3>
                <p className="text-gray-500 font-medium max-w-xs mx-auto leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </RevealSection>
      </section>

      {/* ═══════════ LAB TESTS — Client Island ═══════════ */}
      <section className="py-16 md:py-24 bg-gray-50/70">
        <RevealSection className="container mx-auto px-4 max-w-7xl">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-100 mb-4">
              <Beaker className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-bold text-blue-700">Comprehensive Testing</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-gray-900 mb-4">
              Lab Tests & Profiles
            </h2>
            <p className="text-lg text-gray-500 font-medium max-w-2xl mx-auto">
              Precisely targeted diagnostics for specific health concerns
            </p>
          </div>
          <FeaturedTests />
        </RevealSection>
      </section>

      {/* ═══════════ HEALTH CAMPS — Client Island ═══════════ */}
      <section className="py-16 md:py-24 bg-white">
        <RevealSection className="container mx-auto px-4 max-w-7xl">
          <FeaturedCamps />
        </RevealSection>
      </section>

      {/* ═══════════ WHY CHOOSE US — pure server HTML ═══════════ */}
      <section className="py-16 md:py-24 bg-white">
        <RevealSection className="container mx-auto px-4 max-w-6xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-black text-gray-900 mb-4">Why Choose DOCNOW?</h2>
            <p className="text-lg text-gray-500 font-medium">
              Trusted by thousands for reliable, convenient diagnostics
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {whyChooseUs.map((feature) => (
              <Card
                key={feature.title}
                className={`p-6 sm:p-8 text-center border-gray-100 hover:shadow-lg transition-all duration-300 group ${feature.border}`}
              >
                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl ${feature.color} mb-5 group-hover:scale-110 transition-transform`}>
                  <feature.icon className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed font-medium">{feature.desc}</p>
              </Card>
            ))}
          </div>
        </RevealSection>
      </section>

      {/* ═══════════ CALLBACK CTA — Client Island for form ═══════════ */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-gray-50/50 to-white">
        <RevealSection className="container mx-auto px-4 max-w-3xl">
          <Card className="overflow-hidden border-0 shadow-2xl shadow-purple-500/10">
            {/* Header — pure server HTML */}
            <div className="bg-gradient-to-r from-[#2d1670] to-[#4b2192] p-8 sm:p-10 text-center text-white">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-6">
                <Phone className="w-8 h-8" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-black mb-3">Need Help Choosing?</h2>
              <p className="text-white/70 font-medium max-w-md mx-auto">
                Our medical experts will call you back within 15 minutes to help you select the right tests.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-white/80">
                <Building2 className="h-4 w-4" />
                Managing employee testing at scale?
              </div>
            </div>
            {/* Form — client island */}
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

