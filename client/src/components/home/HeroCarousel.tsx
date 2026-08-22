'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Shield,
  Clock,
  Truck,
  Users,
  FlaskConical,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import api from '@/lib/api';

export interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  badgeText?: string | null;
  ctaText: string;
  ctaLink: string;
  secondaryCtaText?: string | null;
  secondaryCtaLink?: string | null;
  imageUrl?: string | null;
  bgGradient: string;
  sortOrder: number;
  isActive: boolean;
}

const DEFAULT_SLIDES: HeroSlide[] = [
  {
    id: 'default-1',
    title: 'Precision Diagnostics, Delivered to Your Door.',
    subtitle:
      'Get NABL & CAP certified lab tests and health checkups at home. Fast, accurate results you can trust.',
    badgeText: '100% SECURE & ACCREDITED',
    ctaText: 'Book a Test',
    ctaLink: '/search',
    secondaryCtaText: 'Explore Packages',
    secondaryCtaLink: '/packages',
    bgGradient:
      'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)',
    sortOrder: 0,
    isActive: true,
  },
  {
    id: 'default-2',
    title: 'Full Body Health Packages Up To 40% OFF',
    subtitle:
      'Comprehensive 60+ parameter health checkups with free home sample collection across 100+ cities.',
    badgeText: 'SPECIAL OFFER • LIMITED TIME',
    ctaText: 'View Packages',
    ctaLink: '/packages',
    secondaryCtaText: 'Book Callback',
    secondaryCtaLink: '/#callback',
    bgGradient:
      'radial-gradient(594.6% 81.5% at 50% 63.68%, #1E3A8A 25.49%, #0F172A 74.17%)',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 'default-3',
    title: 'Community Health Camps Near You',
    subtitle:
      'Join our ongoing wellness initiatives for discounted group testing, health counseling, and rapid report delivery.',
    badgeText: 'COMMUNITY WELLNESS INITIATIVE',
    ctaText: 'Find Nearby Camp',
    ctaLink: '/camps',
    secondaryCtaText: 'Contact Support',
    secondaryCtaLink: '/about',
    bgGradient:
      'radial-gradient(594.6% 81.5% at 50% 63.68%, #065F46 25.49%, #022C22 74.17%)',
    sortOrder: 2,
    isActive: true,
  },
];

const heroStats = [
  { icon: Users, iconBg: 'bg-purple-50', iconColor: 'text-purple-500', value: '50K+', label: 'HAPPY PATIENTS' },
  { icon: FlaskConical, iconBg: 'bg-blue-50', iconColor: 'text-blue-500', value: '200+', label: 'LAB TESTS' },
  { icon: Clock, iconBg: 'bg-orange-50', iconColor: 'text-orange-400', value: '24h', label: 'REPORT DELIVERY' },
  { icon: Truck, iconBg: 'bg-green-50', iconColor: 'text-green-500', value: '100+', label: 'CITIES COVERED' },
];

export function HeroCarousel() {
  const [slides, setSlides] = useState<HeroSlide[]>(DEFAULT_SLIDES);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch dynamic hero slides from CMS
  useEffect(() => {
    async function fetchSlides() {
      try {
        const res = await api.get('/hero-slides');
        if (res.data?.slides && res.data.slides.length > 0) {
          setSlides(res.data.slides);
        }
      } catch (err) {
        // Fallback slides already initialized in state
      }
    }
    fetchSlides();
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  }, [slides.length]);

  // Auto-play timer
  useEffect(() => {
    if (isPaused || slides.length <= 1) return;
    timerRef.current = setInterval(() => {
      handleNext();
    }, 5500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, slides.length, handleNext]);

  // Touch Swipe Handlers
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      handleNext();
    } else if (isRightSwipe) {
      handlePrev();
    }
  };

  const currentSlide = slides[currentIndex] || slides[0];

  return (
    <section
      className="relative pb-16 md:pb-24 lg:pb-32 transition-all duration-700 ease-in-out overflow-hidden"
      style={{ background: currentSlide.bgGradient }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Background Decorative Blur Orbs */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-white/5 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

      <div className="max-w-[1380px] mx-auto px-6 lg:px-16 pt-4 pb-8 lg:pb-16 relative z-10">
        <div className="min-h-[380px] md:min-h-[420px] flex flex-col justify-center">
          {/* Top Badge */}
          {currentSlide.badgeText && (
            <div className="mb-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs font-bold uppercase tracking-wider animate-fadeIn">
              <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
              <span>{currentSlide.badgeText}</span>
            </div>
          )}

          {/* Main Title */}
          <h1 className="text-white font-black font-inter text-4xl md:text-5xl lg:text-[56px] leading-[1.1] mb-5 max-w-3xl transition-all duration-500">
            {currentSlide.title}
          </h1>

          {/* Subtitle */}
          <p className="text-white/85 font-inter text-base md:text-lg mb-8 leading-relaxed max-w-xl">
            {currentSlide.subtitle}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center gap-4 mb-10">
            {currentSlide.ctaText && (
              <Link
                href={currentSlide.ctaLink || '/search'}
                className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 bg-gradient-to-r from-amber-400 to-orange-500 text-gray-900 font-extrabold rounded-xl shadow-lg hover:shadow-orange-500/30 hover:scale-105 active:scale-95 transition-all text-base"
              >
                <span>{currentSlide.ctaText}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}

            {currentSlide.secondaryCtaText && (
              <Link
                href={currentSlide.secondaryCtaLink || '/packages'}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/25 text-white font-bold rounded-xl transition-all text-base hover:scale-105 active:scale-95"
              >
                <span>{currentSlide.secondaryCtaText}</span>
              </Link>
            )}
          </div>

          {/* Trust Badges */}
          <div className="flex flex-wrap items-center gap-5 text-white/80 text-sm font-inter font-semibold">
            <span className="flex items-center gap-1.5">
              <Shield size={15} className="text-white/70" />
              100% SECURE & CONFIDENTIAL
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={15} className="text-white/70" />
              REPORTS IN 24H
            </span>
            <span className="flex items-center gap-1.5">
              <Truck size={15} className="text-white/70" />
              FREE HOME COLLECTION
            </span>
          </div>
        </div>
      </div>

      {/* Controls & Pagination */}
      {slides.length > 1 && (
        <div className="max-w-[1380px] mx-auto px-6 lg:px-16 flex items-center justify-between relative z-10 -mt-6 mb-6">
          {/* Dot Indicators */}
          <div className="flex items-center gap-2">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Go to slide ${idx + 1}`}
                className={`h-2.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex
                    ? 'w-8 bg-amber-400'
                    : 'w-2.5 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>

          {/* Arrow Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrev}
              aria-label="Previous slide"
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/25 text-white backdrop-blur-md border border-white/20 transition-all hover:scale-110 active:scale-90"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={handleNext}
              aria-label="Next slide"
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/25 text-white backdrop-blur-md border border-white/20 transition-all hover:scale-110 active:scale-90"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Floating Stats Card */}
      <div className="hidden lg:block absolute -bottom-14 left-1/2 -translate-x-1/2 w-[calc(100%-5rem)] max-w-4xl z-20">
        <HeroStatsCard />
      </div>
      <div className="lg:hidden mx-4 relative z-20 -mb-4">
        <HeroStatsCard />
      </div>
    </section>
  );
}

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
