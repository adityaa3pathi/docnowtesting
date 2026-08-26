'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Shield, Clock, Truck } from 'lucide-react';
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
  const hasSlides = slides.length > 0;

  return (
    <section
      className="relative w-full overflow-hidden"
      style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Decorative blur orbs */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-white/5 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

      <div className="max-w-[1380px] mx-auto px-6 lg:px-16 relative z-10">
        {/* ─── Desktop Layout ─── */}
        <div className="hidden md:flex items-center min-h-[420px] gap-8 lg:gap-12 py-8">
          {/* Left: Text Content */}
          <div className="flex-1 max-w-[55%]">
            <span className="inline-block px-4 py-1.5 bg-white/10 backdrop-blur-sm text-white/90 text-xs font-bold rounded-full border border-white/20 tracking-wider mb-6">
              100% SECURE & ACCREDITED
            </span>
            <h1 className="text-4xl lg:text-5xl font-black text-white leading-[1.1] mb-5">
              Precision Diagnostics,{' '}
              <br />
              Delivered to Your Door.
            </h1>
            <p className="text-base lg:text-lg text-white/70 font-medium max-w-md mb-8 leading-relaxed">
              Get NABL & CAP certified lab tests and health checkups at home.
              <br />
              Fast, accurate results you can trust.
            </p>

            <div className="flex flex-wrap gap-3 mb-8">
              <a
                href="/search"
                className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-[#4B0082] font-bold rounded-xl hover:bg-gray-100 transition-all shadow-lg text-sm"
              >
                Book a Test Now
              </a>
              <a
                href="/packages"
                className="inline-flex items-center gap-2 px-7 py-3.5 bg-white/10 text-white font-bold rounded-xl border border-white/25 hover:bg-white/20 transition-all text-sm"
              >
                View Health Packages
              </a>
            </div>

            <div className="flex items-center gap-6 text-white/50 text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                <Shield size={14} /> 100% SECURE
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={14} /> REPORTS IN 24H
              </span>
              <span className="flex items-center gap-1.5">
                <Truck size={14} /> FREE COLLECTION
              </span>
            </div>
          </div>

          {/* Right: Image */}
          <div className="flex-1 max-w-[45%] relative flex items-center justify-end">
            {hasSlides && current ? (
              <div className="relative w-full max-w-[520px]">
                <img
                  key={current.id}
                  src={current.desktopImageUrl || current.mobileImageUrl || ''}
                  alt={current.imageAlt || 'Healthcare professional'}
                  className="w-full h-[360px] lg:h-[400px] object-cover rounded-3xl shadow-2xl transition-opacity duration-500"
                  style={{ borderRadius: '24px 24px 24px 80px' }}
                />
                {/* Subtle decorative shape behind image */}
                <div
                  className="absolute -bottom-4 -left-4 w-32 h-32 bg-purple-400/20 rounded-full blur-2xl pointer-events-none"
                />
              </div>
            ) : (
              /* Placeholder when no image slides */
              <div
                className="w-full max-w-[520px] h-[360px] lg:h-[400px] bg-white/5 border border-white/10 flex items-center justify-center"
                style={{ borderRadius: '24px 24px 24px 80px' }}
              >
                <div className="text-center text-white/30">
                  <div className="text-5xl mb-2">🩺</div>
                  <p className="text-sm font-medium">Healthcare Hero Image</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Mobile Layout ─── */}
        <div className="md:hidden py-8">
          {/* Image at top right */}
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-1">
              <h1 className="text-2xl font-black text-white leading-tight">
                Precision Diagnostics, Delivered to Your Door.
              </h1>
            </div>
            {hasSlides && current && (
              <div className="flex-shrink-0 w-36 h-36">
                <img
                  key={current.id}
                  src={current.mobileImageUrl || current.desktopImageUrl || ''}
                  alt={current.imageAlt || 'Healthcare'}
                  className="w-full h-full object-cover shadow-lg"
                  style={{ borderRadius: '16px 16px 16px 48px' }}
                />
              </div>
            )}
          </div>

          <p className="text-sm text-white/70 font-medium mb-6 leading-relaxed">
            Get NABL & CAP certified lab tests and health checkups at home.
            Fast, accurate results you can trust.
          </p>

          <div className="flex flex-col gap-3 mb-6">
            <a
              href="/packages"
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-white/10 text-white font-bold rounded-xl border border-white/25 text-sm"
            >
              View Health Packages
            </a>
            <a
              href="/search"
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-white text-[#4B0082] font-bold rounded-xl shadow-lg text-sm"
            >
              Book a Test Now
            </a>
          </div>
        </div>
      </div>

      {/* Carousel dots — only if multiple slides */}
      {slides.length > 1 && (
        <div className="relative z-10 pb-5">
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

      {/* Desktop arrows — only if multiple slides */}
      {slides.length > 1 && (
        <div className="hidden md:block">
          <button
            onClick={handlePrev}
            aria-label="Previous slide"
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all z-10"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={handleNext}
            aria-label="Next slide"
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all z-10"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </section>
  );
}
