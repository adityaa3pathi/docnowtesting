'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Shield, Clock, Truck, Users, Beaker, Building2, Calendar, Package } from 'lucide-react';
import api from '@/lib/api';

interface HeroSlide {
  id: string;
  desktopImageUrl?: string | null;
  mobileImageUrl?: string | null;
  imageAlt?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export function HeroCarousel() {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function fetchSlides() {
      try {
        const res = await api.get('/hero-slides');
        if (res.data?.slides?.length > 0) {
          const withImages = res.data.slides.filter(
            (s: HeroSlide) => s.desktopImageUrl || s.mobileImageUrl
          );
          if (withImages.length > 0) setSlides(withImages);
        }
      } catch {
        // Fallback hero will show
      } finally {
        setIsLoading(false);
      }
    }
    fetchSlides();
  }, []);

  // Reset image loaded state when slide changes
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  }, [slides.length]);

  // Auto-play
  useEffect(() => {
    if (isPaused || slides.length <= 1) return;
    timerRef.current = setInterval(handleNext, 5500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, slides.length, handleNext]);

  // Touch swipe
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
    if (distance > minSwipeDistance) handleNext();
    else if (distance < -minSwipeDistance) handlePrev();
  };

  const current = slides.length > 0 ? (slides[currentIndex] || slides[0]) : null;
  const hasSlides = slides.length > 0 && current;
  // Preload next image
  const nextIndex = slides.length > 1 ? (currentIndex + 1) % slides.length : -1;
  const nextSlide = nextIndex >= 0 ? slides[nextIndex] : null;



  /* ─── Trust Badges ─── */
  const TrustBadges = ({ className = '' }: { className?: string }) => (
    <div className={`flex items-center gap-4 sm:gap-6 text-white/50 text-[10px] sm:text-xs font-semibold ${className}`}>
      <span className="flex items-center gap-1.5">
        <Shield size={13} className="flex-shrink-0" /> 100% SECURE
      </span>
      <span className="flex items-center gap-1.5">
        <Clock size={13} className="flex-shrink-0" /> REPORTS IN 24H
      </span>
      <span className="flex items-center gap-1.5">
        <Truck size={13} className="flex-shrink-0" /> FREE COLLECTION
      </span>
    </div>
  );

  return (
    <section
      className="relative w-full overflow-visible pb-36 sm:pb-32 lg:pb-28 mb-20 sm:mb-20 lg:mb-24"
      style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      aria-label="Hero banner carousel"
    >
      {/* Decorative blur orbs */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-white/5 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

      {/* ─── DESKTOP RIGHT IMAGE (Direct child of section — spans top-0 to bottom-0, right 45%) ─── */}
      <div
        className="hidden lg:block absolute top-0 right-0 bottom-0 w-[45%] overflow-hidden z-0"
        aria-live="polite"
      >
        {/* Shimmer */}
        {(isLoading || (hasSlides && !imgLoaded && !imgError)) && (
          <div className="absolute inset-0 bg-white/5 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-white/10 to-white/5 animate-pulse" />
          </div>
        )}

        {/* Image */}
        {hasSlides && !imgError && (
          <img
            key={current!.id}
            src={current!.desktopImageUrl || current!.mobileImageUrl || ''}
            alt={current!.imageAlt || 'Healthcare professional'}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover object-center transition-opacity duration-500 ease-in-out ${
              imgLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* Fallback */}
        {(!hasSlides && !isLoading) || imgError ? (
          <div className="w-full h-full bg-gradient-to-br from-white/5 to-transparent" />
        ) : null}
      </div>

      <div className="max-w-[1380px] mx-auto px-5 sm:px-6 lg:px-16 relative z-10">

        {/* ────────────────────────── DESKTOP TEXT CONTENT ────────────────────────── */}
        <div className="hidden lg:block pt-12 pb-24 xl:pt-16 xl:pb-28">
          <div className="max-w-[50%]">
            <span className="inline-block px-4 py-1.5 bg-white/10 backdrop-blur-sm text-white/90 text-xs font-bold rounded-full border border-white/20 tracking-wider mb-5">
              100% SECURE & ACCREDITED
            </span>

            <h1 className="text-4xl lg:text-[2.85rem] xl:text-5xl font-black text-white leading-[1.08] mb-5">
              Precision Diagnostics,
              <br />
              Delivered to Your Door.
            </h1>

            <p className="text-base lg:text-lg text-white/65 font-medium max-w-md mb-8 leading-relaxed">
              Get NABL & CAP certified lab tests and health checkups at home.
              <br className="hidden xl:block" />
              Fast, accurate results you can trust.
            </p>

            <div className="flex flex-wrap gap-3 mb-8">
              <a
                href="/search"
                className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-[#4B0082] font-bold rounded-xl hover:bg-gray-100 active:scale-[0.97] transition-all shadow-lg text-sm"
              >
                Book a Test Now
              </a>
              <a
                href="/packages"
                className="inline-flex items-center gap-2 px-7 py-3.5 bg-white/10 text-white font-bold rounded-xl border border-white/25 hover:bg-white/20 active:scale-[0.97] transition-all text-sm"
              >
                View Health Packages
              </a>
            </div>

            <TrustBadges />
          </div>
        </div>

        {/* ────────────────────────── MOBILE / TABLET layout ────────────────────────── */}
        <div className="lg:hidden">

          {/* Top row: Text + Right Image (image flush to right, straight edges) */}
          <div className="relative min-h-[260px] sm:min-h-[300px] flex items-stretch mb-6">

            {/* Left: Text Content */}
            <div className="w-[52%] sm:w-[50%] pr-3 pt-3 pb-2 z-10 flex flex-col justify-center">
              <h1 className="text-xl sm:text-2xl font-black text-white leading-[1.12] mb-3">
                Precision Diagnostics, Delivered to Your Door.
              </h1>
              <p className="text-[11px] sm:text-xs text-white/75 font-medium leading-relaxed">
                Get NABL & CAP certified lab tests and health checkups at home.
                Fast, accurate results you can trust.
              </p>
            </div>

            {/* Right: Image — flush to screen edge, no rounded borders */}
            <div
              className="w-[calc(48%+1.25rem)] sm:w-[calc(50%+1.5rem)] -mr-5 sm:-mr-6 relative overflow-hidden rounded-none"
              aria-live="polite"
            >
              {hasSlides && !imgError ? (
                <img
                  key={current!.id}
                  src={current!.mobileImageUrl || current!.desktopImageUrl || ''}
                  alt={current!.imageAlt || 'Healthcare'}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                  className={`w-full h-full object-cover object-center transition-opacity duration-500 ${
                    imgLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              ) : !isLoading ? (
                <div className="w-full h-full bg-gradient-to-br from-white/10 to-transparent" />
              ) : null}

              {/* Shimmer while loading */}
              {hasSlides && !imgLoaded && !imgError && (
                <div className="absolute inset-0 bg-white/5 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-white/10 to-white/5 animate-pulse" />
                </div>
              )}
            </div>
          </div>

          {/* CTAs — Side-by-side buttons with icons matching design */}
          <div className="grid grid-cols-2 gap-3 pb-5">
            <a
              href="/packages"
              className="flex items-center justify-center gap-2 px-3 py-3 sm:py-3.5 bg-white/10 text-white font-bold rounded-xl border border-white/30 hover:bg-white/20 active:scale-[0.97] transition-all text-xs sm:text-sm text-center"
            >
              <Package size={16} className="flex-shrink-0" />
              <span>View Health Packages</span>
            </a>
            <a
              href="/search"
              className="flex items-center justify-center gap-2 px-3 py-3 sm:py-3.5 bg-white text-[#4B0082] font-bold rounded-xl shadow-lg hover:bg-gray-100 active:scale-[0.97] transition-all text-xs sm:text-sm text-center"
            >
              <Calendar size={16} className="flex-shrink-0" />
              <span>Book a Test Now</span>
            </a>
          </div>

          {/* Mobile trust badges */}
          <TrustBadges className="justify-between sm:justify-center pb-6" />
        </div>
      </div>

      {/* ─── Carousel Dots ─── */}
      {slides.length > 1 && (
        <div className="relative z-10 pb-4 lg:pb-5">
          <div className="flex items-center justify-center gap-2">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Go to slide ${idx + 1}`}
                className={`h-2 rounded-full transition-all duration-300 ${
                  idx === currentIndex
                    ? 'w-7 bg-white'
                    : 'w-2 bg-white/30 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── Desktop Nav Arrows ─── */}
      {slides.length > 1 && (
        <div className="hidden lg:block">
          <button
            onClick={handlePrev}
            aria-label="Previous slide"
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white backdrop-blur-sm transition-all z-10"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={handleNext}
            aria-label="Next slide"
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white backdrop-blur-sm transition-all z-10"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {/* ─── STATS BAR CARD (Responsive for mobile & desktop, hangs half in hero, half below) ─── */}
      <div className="absolute -bottom-16 sm:-bottom-14 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-4xl z-20">
        <div className="bg-white rounded-2xl shadow-[0_9px_30px_rgba(0,0,0,0.15)] px-4 sm:px-8 py-4 sm:py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {[
              { icon: Users, value: '50K+', label: 'HAPPY PATIENTS', iconBg: 'bg-purple-50', iconColor: 'text-purple-500' },
              { icon: Beaker, value: '200+', label: 'LAB TESTS', iconBg: 'bg-blue-50', iconColor: 'text-blue-500' },
              { icon: Clock, value: '24h', label: 'REPORT DELIVERY', iconBg: 'bg-orange-50', iconColor: 'text-orange-400' },
              { icon: Building2, value: '100+', label: 'CITIES COVERED', iconBg: 'bg-green-50', iconColor: 'text-green-500' },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col items-center gap-1.5 text-center">
                <div className={`w-9 h-9 sm:w-11 sm:h-11 rounded-full ${stat.iconBg} flex items-center justify-center`}>
                  <stat.icon size={20} className={`${stat.iconColor} sm:hidden`} />
                  <stat.icon size={24} className={`${stat.iconColor} hidden sm:block`} />
                </div>
                <span className="font-black text-xl sm:text-2xl md:text-3xl text-gray-900">{stat.value}</span>
                <span className="font-semibold text-[10px] sm:text-xs text-gray-400 tracking-wide uppercase">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
