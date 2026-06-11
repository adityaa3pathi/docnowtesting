"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { Footer } from '@/components/Footer';
import { Button, Card, Input } from '@/components/ui';
import { ProductMarketingCard, ProductDetailsSummary } from '@/components/catalog/ProductMarketingCard';

import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { generateProductSlug } from '@/lib/mapProductDetails';
import toast from 'react-hot-toast';
import {
  Search,
  ArrowRight,
  Award,
  Clock,
  Shield,
  Users,
  Phone,
  Beaker,
  CheckCircle2,
  Truck,
  Building2,
  FileCheck,
  Loader2,
  ChevronRight,
  FlaskConical,
  Star,
  Lock,
} from 'lucide-react';

// ────────────────────── Types
interface CatalogProduct {
  id: string;
  partnerCode: string;
  name: string;
  type: string;
  price: number;
  mrp: number | null;
  displayPrice: number;
  discountedPrice: number | null;
  description: string | null;
  parameters: string | null;
  sampleType: string | null;
  reportTime: string | null;
  categories: { id: string; name: string; slug: string }[];
  detailsSummary?: ProductDetailsSummary | null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNetworkError(error: unknown) {
  return typeof error === 'object' && error !== null && 'isNetworkError' in error;
}

// ────────────────────── Component
export default function Home() {
  const router = useRouter();
  const { addToCart, cart } = useCart();
  const { isAuthenticated } = useAuth();

  // Data state
  const [packages, setPackages] = useState<CatalogProduct[]>([]);
  const [tests, setTests] = useState<CatalogProduct[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [loadingTests, setLoadingTests] = useState(true);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);

  // Callback state
  const [callbackName, setCallbackName] = useState('');
  const [callbackMobile, setCallbackMobile] = useState('');
  const [submittingCallback, setSubmittingCallback] = useState(false);
  const [callbackSent, setCallbackSent] = useState(false);

  // Animation observer
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // ── Intersection observer for reveal animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set(prev).add(entry.target.id));
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -50px 0px' }
    );

    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [loadingPackages, loadingTests]);

  const fetchPackages = useCallback(async (retries = 2) => {
    try {
      const res = await api.get('/catalog/featured', { params: { type: 'PACKAGE', limit: 6 } });
      setPackages(res.data.products || []);
    } catch (err: unknown) {
      if (retries > 0 && isNetworkError(err)) {
        await new Promise(r => setTimeout(r, 1500));
        return fetchPackages(retries - 1);
      }
      console.warn('[Home] Could not load packages:', getErrorMessage(err));
    } finally {
      setLoadingPackages(false);
    }
  }, []);

  const fetchTests = useCallback(async (retries = 2) => {
    try {
      const res = await api.get('/catalog/featured', { params: { type: 'TEST,PROFILE', limit: 9 } });
      setTests(res.data.products || []);
    } catch (err: unknown) {
      if (retries > 0 && isNetworkError(err)) {
        await new Promise(r => setTimeout(r, 1500));
        return fetchTests(retries - 1);
      }
      console.warn('[Home] Could not load tests:', getErrorMessage(err));
    } finally {
      setLoadingTests(false);
    }
  }, []);

  // ── Fetch catalog data
  useEffect(() => {
    fetchPackages();
    fetchTests();
  }, [fetchPackages, fetchTests]);

  const handleBookNow = async (product: CatalogProduct) => {
    if (!isAuthenticated) {
      toast.error('Please log in to book this test');
      return;
    }
    if (isInCart(product.partnerCode)) {
      router.push('/cart');
      return;
    }

    setAddingToCart(product.partnerCode);
    const success = await addToCart(
      product.partnerCode,
      product.name,
      product.price,
      product.mrp ?? undefined
    );
    setAddingToCart(null);
    if (success) router.push('/cart');
  };

  const isInCart = (code: string) =>
    cart?.items?.some((i) => i.testCode === code) ?? false;

  const handleCallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callbackName.trim() || !callbackMobile.trim()) {
      toast.error('Please enter your name and mobile number');
      return;
    }
    if (!/^[6-9]\d{9}$/.test(callbackMobile.replace(/\s/g, ''))) {
      toast.error('Please enter a valid 10-digit mobile number');
      return;
    }
    setSubmittingCallback(true);
    try {
      await api.post('/callback/request', {
        name: callbackName.trim(),
        mobile: callbackMobile.trim(),
      });
      setCallbackSent(true);
      toast.success('Callback request submitted! We\'ll call you shortly.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmittingCallback(false);
    }
  };

  const setSectionRef = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  const sectionClass = (id: string) =>
    `transition-all duration-700 ease-out ${visibleSections.has(id) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`;

  // ────────────────────── Render
  return (
    <main className="flex flex-col min-h-screen bg-white">
      {/* ═══════════ HERO ═══════════ */}
      <section
        className="relative pb-16 md:pb-24 lg:pb-32"
        style={{
          background:
            'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)',
        }}
      >
        {/* Content */}
        <div className="max-w-[1380px] mx-auto px-6 lg:px-16 pt-4 pb-8 lg:pb-16">
          <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-0">

            {/* Left: Hero Text + CTAs */}
            <div className="flex-1 flex flex-col items-start pt-8 lg:pt-16 max-w-xl lg:max-w-none lg:pr-10">
              <h1 className="text-white font-black font-inter text-4xl md:text-5xl lg:text-[56px] leading-[1.1] mb-5">
                Precision Diagnostics,{' '}
                <br className="hidden sm:block" />
                Delivered to Your Door.
              </h1>
              <p className="text-white/80 font-inter text-base md:text-lg mb-10 leading-relaxed max-w-lg">
                Get NABL &amp; CAP certified lab tests and health checkups at home.
                Fast, accurate results you can trust.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-wrap gap-4 mb-10">
                <button
                  onClick={() => router.push('/search?type=TEST')}
                  className="border border-white text-white font-inter font-semibold text-base px-6 py-3 rounded-lg hover:bg-white/10 transition-all whitespace-nowrap"
                >
                  Book a Test Now
                </button>
                <button
                  onClick={() => router.push('/search?type=PACKAGE')}
                  className="border border-white text-white font-inter font-semibold text-base px-6 py-3 rounded-lg hover:bg-white/10 transition-all whitespace-nowrap"
                >
                  View Health Packages
                </button>
              </div>

              {/* Trust Badges */}
              <div className="flex flex-wrap items-center gap-5 text-white/80 text-sm font-inter font-semibold">
                <span className="flex items-center gap-1.5">
                  <Shield size={15} className="text-white/70" />
                  100% SECURE
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock size={15} className="text-white/70" />
                  REPORTS IN 24H
                </span>
                <span className="flex items-center gap-1.5">
                  <Truck size={15} className="text-white/70" />
                  FREE COLLECTION
                </span>
              </div>
            </div>


          </div>
        </div>

        {/* Stats Card — overlaps bottom on desktop */}
        <div className="hidden lg:block absolute -bottom-14 left-1/2 -translate-x-1/2 w-[calc(100%-5rem)] max-w-4xl z-20">
          <HeroStatsCard />
        </div>

        {/* Stats Card — mobile (in-flow) */}
        <div className="lg:hidden mx-4 relative z-20 -mb-4">
          <HeroStatsCard />
        </div>
      </section>





      {/* ═══════════ HEALTH PACKAGES ═══════════ */}
      <section
        id="packages"
        ref={setSectionRef('packages')}
        className="py-16 md:py-24 bg-gradient-to-b from-white to-gray-50/50"
      >
        <div className={`container mx-auto px-4 max-w-7xl ${sectionClass('packages')}`}>
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

          {loadingPackages ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : packages.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
              <FlaskConical className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">No packages available right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {packages.slice(0, 6).map((pkg) => {
                const slug = generateProductSlug(pkg.name, pkg.partnerCode);
                const pkgBasePath = pkg.type === 'PROFILE' ? 'profiles' : 'packages';

                return (
                  <ProductMarketingCard
                    key={pkg.id}
                    product={pkg}
                    detailHref={`/${pkgBasePath}/${slug}`}
                    onBookNow={handleBookNow}
                    isBooking={addingToCart === pkg.partnerCode}
                    inCartCount={cart?.items.filter(i => i.testCode === pkg.partnerCode).length || 0}
                  />
                );
              })}
            </div>
          )}

          <div className="mt-12 text-center">
            <Button
              variant="outline"
              size="lg"
              onClick={() => router.push('/search?type=PACKAGE')}
              className="border-purple-200 text-purple-700 hover:bg-purple-50"
            >
              View All Packages
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      <section
        id="how-it-works"
        ref={setSectionRef('how-it-works')}
        className="py-16 md:py-24 bg-white"
      >
        <div className={`container mx-auto px-4 max-w-6xl ${sectionClass('how-it-works')}`}>
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-black text-gray-900 mb-4">
              How It Works
            </h2>
            <p className="text-lg text-gray-500 font-medium">
              Book a test in 3 easy steps
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-4 relative">
            {/* Connector line — desktop only */}
            <div className="hidden md:block absolute top-16 left-[20%] right-[20%] h-0.5 bg-gradient-to-r from-purple-200 via-purple-400 to-purple-200" />

            {[
              {
                step: '01',
                title: 'Choose Your Test',
                description: 'Browse our catalog and select the tests or health packages you need.',
                icon: Search,
                color: 'from-purple-500 to-indigo-600',
              },
              {
                step: '02',
                title: 'Schedule Collection',
                description: 'Pick a convenient date, time, and address for home sample collection.',
                icon: Clock,
                color: 'from-fuchsia-500 to-purple-600',
              },
              {
                step: '03',
                title: 'Get Digital Reports',
                description: 'Receive accurate, lab-certified digital reports within 24-48 hours.',
                icon: FileCheck,
                color: 'from-pink-500 to-fuchsia-600',
              },
            ].map((item) => (
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
        </div>
      </section>

      {/* ═══════════ LAB TESTS ═══════════ */}
      <section
        id="tests"
        ref={setSectionRef('tests')}
        className="py-16 md:py-24 bg-gray-50/70"
      >
        <div className={`container mx-auto px-4 max-w-7xl ${sectionClass('tests')}`}>
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

          {loadingTests ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : tests.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
              <Beaker className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">No tests available right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tests.map((test) => {
                const slug = generateProductSlug(test.name, test.partnerCode);
                const testBasePath = test.type === 'PROFILE' ? 'profiles' : 'tests';

                return (
                  <ProductMarketingCard
                    key={test.id}
                    product={test}
                    detailHref={`/${testBasePath}/${slug}`}
                    onBookNow={handleBookNow}
                    isBooking={addingToCart === test.partnerCode}
                    inCartCount={cart?.items.filter(i => i.testCode === test.partnerCode).length || 0}
                  />
                );
              })}
            </div>
          )}

          <div className="mt-10 text-center">
            <Button
              variant="outline"
              size="lg"
              onClick={() => router.push('/search?type=TEST')}
              className="border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              View All Tests
              <ChevronRight className="ml-1 w-5 h-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* ═══════════ WHY CHOOSE US ═══════════ */}
      <section
        id="why-us"
        ref={setSectionRef('why-us')}
        className="py-16 md:py-24 bg-white"
      >
        <div className={`container mx-auto px-4 max-w-6xl ${sectionClass('why-us')}`}>
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-5xl font-black text-gray-900 mb-4">Why Choose DOCNOW?</h2>
            <p className="text-lg text-gray-500 font-medium">
              Trusted by thousands for reliable, convenient diagnostics
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Award,
                title: 'Certified Labs',
                desc: 'NABL & CAP accredited laboratories ensuring highest accuracy standards.',
                color: 'bg-amber-50 text-amber-600',
                border: 'hover:border-amber-200',
              },
              {
                icon: Clock,
                title: 'Fast Reports',
                desc: 'Get lab-certified digital reports within 24-48 hours of sample collection.',
                color: 'bg-blue-50 text-blue-600',
                border: 'hover:border-blue-200',
              },
              {
                icon: Lock,
                title: 'Data Privacy',
                desc: '100% encrypted and confidential. Your health data stays yours.',
                color: 'bg-green-50 text-green-600',
                border: 'hover:border-green-200',
              },
              {
                icon: Star,
                title: 'Expert Team',
                desc: 'Experienced phlebotomists and healthcare professionals at your doorstep.',
                color: 'bg-purple-50 text-purple-600',
                border: 'hover:border-purple-200',
              },
            ].map((feature) => (
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
        </div>
      </section>

      {/* ═══════════ CALLBACK CTA ═══════════ */}
      <section
        id="callback-section"
        ref={setSectionRef('callback-section')}
        className="py-16 md:py-24 bg-gradient-to-b from-gray-50/50 to-white"
      >
        <div className={`container mx-auto px-4 max-w-3xl ${sectionClass('callback-section')}`}>
          <Card className="overflow-hidden border-0 shadow-2xl shadow-purple-500/10">
            {/* Gradient header */}
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

            {/* Form body */}
            <div className="p-6 sm:p-10">
              {callbackSent ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Request Received!</h3>
                  <p className="text-gray-500 font-medium">
                    Our team will call you within 15 minutes. Thank you!
                  </p>
                </div>
              ) : (
                <form onSubmit={handleCallbackSubmit} className="space-y-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Your Name</label>
                    <Input
                      placeholder="Enter your full name"
                      value={callbackName}
                      onChange={(e) => setCallbackName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Mobile Number</label>
                    <Input
                      placeholder="10-digit mobile number"
                      value={callbackMobile}
                      onChange={(e) => setCallbackMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      required
                    />
                  </div>
                  <Button
                    size="lg"
                    className="w-full py-7 text-lg mt-2"
                    disabled={submittingCallback}
                  >
                    {submittingCallback ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Phone className="w-5 h-5 mr-2" />
                        Request Callback
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-gray-400 text-center font-medium mt-2">
                    By requesting a callback, you agree to our{' '}
                    <a href="/privacy" className="text-purple-600 underline">Privacy Policy</a>.
                  </p>
                  <div className="rounded-2xl border border-purple-100 bg-purple-50 px-4 py-4 text-left">
                    <p className="text-sm font-bold text-[#2d1670]">Need a corporate diagnostics partner instead?</p>
                    <p className="mt-1 text-sm text-gray-600">
                      Talk to our corporate team for employee wellness programs, onsite camps, and bulk testing partnerships.
                    </p>
                    <Link href="/corporate" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-[#4b2192] hover:text-[#2d1670]">
                      Talk to our corporate team
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </form>
              )}
            </div>
          </Card>
        </div>
      </section>

      <Footer />
    </main>
  );
}

// ────────────────────── HeroStatsCard
const heroStats = [
  {
    icon: Users,
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-500',
    value: '50K+',
    label: 'HAPPY PATIENTS',
  },
  {
    icon: FlaskConical,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-500',
    value: '200+',
    label: 'LAB TESTS',
  },
  {
    icon: Clock,
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-400',
    value: '24h',
    label: 'REPORT DELIVERY',
  },
  {
    icon: Truck,
    iconBg: 'bg-green-50',
    iconColor: 'text-green-500',
    value: '100+',
    label: 'CITIES COVERED',
  },
];

function HeroStatsCard() {
  return (
    <div className="bg-white rounded-2xl shadow-[0_9px_30px_rgba(0,0,0,0.18)] px-6 py-6 md:px-10">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-4">
        {heroStats.map((stat) => (
          <div key={stat.label} className="flex flex-col items-center gap-2 text-center">
            <div className={`w-11 h-11 rounded-full ${stat.iconBg} flex items-center justify-center`}>
              <stat.icon size={24} className={stat.iconColor} />
            </div>
            <span className="font-inter font-black text-2xl md:text-3xl text-gray-900">
              {stat.value}
            </span>
            <span className="font-inter font-semibold text-xs text-gray-400 tracking-wide uppercase">
              {stat.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
