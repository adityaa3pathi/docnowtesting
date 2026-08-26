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

  /* ─── Shared image container shape ─── */
  const imageShape = { borderRadius: '24px 24px 24px 80px' } as const;
  const mobileImageShape = { borderRadius: '16px 16px 16px 48px' } as const;

  /* ─── Image Shimmer Skeleton ─── */
  const ShimmerSkeleton = ({ className, style }: { className: string; style?: React.CSSProperties }) => (
    <div
      className={`${className} overflow-hidden`}
      style={style}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-white/10 to-white/5 animate-pulse" />
    </div>
  );

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
      className="relative w-full overflow-hidden"
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

      <div className="max-w-[1380px] mx-auto px-5 sm:px-6 lg:px-16 relative z-10">

        {/* ────────────────────────── DESKTOP ────────────────────────── */}
        <div className="hidden md:flex items-center min-h-[440px] gap-8 lg:gap-14 py-10 lg:py-12">

          {/* Left: Text Content */}
          <div className="flex-1 min-w-0" style={{ maxWidth: '55%' }}>
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
              <br className="hidden lg:block" />
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

          {/* Right: Image with crossfade */}
          <div className="flex-1 relative flex items-center justify-end" style={{ maxWidth: '45%' }} aria-live="polite">
            <div className="relative w-full max-w-[520px]">

              {/* Shimmer skeleton (shows while loading or during initial fetch) */}
              {(isLoading || (hasSlides && !imgLoaded && !imgError)) && (
                <ShimmerSkeleton
                  className="absolute inset-0 w-full h-[360px] lg:h-[400px] bg-white/5"
                  style={imageShape}
                />
              )}

              {/* Actual image with crossfade */}
              {hasSlides && !imgError && (
                <img
                  key={current!.id}
                  src={current!.desktopImageUrl || current!.mobileImageUrl || ''}
                  alt={current!.imageAlt || 'Healthcare professional'}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                  className={`w-full h-[360px] lg:h-[400px] object-cover shadow-2xl transition-opacity duration-500 ease-in-out ${
                    imgLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={imageShape}
                />
              )}

              {/* Fallback when no slides or image error — clean gradient, no emoji */}
              {(!hasSlides && !isLoading) || imgError ? (
                <div
                  className="w-full h-[360px] lg:h-[400px] bg-gradient-to-br from-white/8 to-white/3 border border-white/10 shadow-xl"
                  style={imageShape}
                />
              ) : null}

              {/* Decorative glow */}
              <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-purple-400/15 rounded-full blur-2xl pointer-events-none" />
            </div>
          </div>
        </div>

        {/* ────────────────────────── MOBILE ────────────────────────── */}
        <div className="md:hidden py-8 pb-6">

          {/* Title + Image side-by-side */}
          <div className="flex items-start gap-4 mb-5">
            <div className="flex-1 min-w-0 pt-1">
              <span className="inline-block px-3 py-1 bg-white/10 text-white/80 text-[10px] font-bold rounded-full border border-white/15 tracking-wider mb-3">
                100% SECURE
              </span>
              <h1 className="text-[1.55rem] sm:text-[1.7rem] font-black text-white leading-[1.12]">
                Precision Diagnostics, Delivered to Your Door.
              </h1>
            </div>

            {/* Mobile image — responsive width */}
            <div className="flex-shrink-0 w-[38%] max-w-[160px] relative" aria-live="polite">
              {hasSlides && !imgError ? (
                <img
                  key={current!.id}
                  src={current!.mobileImageUrl || current!.desktopImageUrl || ''}
                  alt={current!.imageAlt || 'Healthcare'}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                  className={`w-full aspect-square object-cover shadow-lg transition-opacity duration-500 ${
                    imgLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={mobileImageShape}
                />
              ) : (
                <div
                  className="w-full aspect-square bg-gradient-to-br from-white/8 to-white/3 border border-white/10 shadow-lg"
                  style={mobileImageShape}
                />
              )}

              {/* Shimmer while loading */}
              {hasSlides && !imgLoaded && !imgError && (
                <ShimmerSkeleton
                  className="absolute inset-0 w-full aspect-square bg-white/5"
                  style={mobileImageShape}
                />
              )}
            </div>
          </div>

          <p className="text-[13px] sm:text-sm text-white/65 font-medium mb-6 leading-relaxed">
            Get NABL & CAP certified lab tests and health checkups at home.
            Fast, accurate results you can trust.
          </p>

          {/* Mobile CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <a
              href="/packages"
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-white/10 text-white font-bold rounded-xl border border-white/25 active:scale-[0.97] transition-all text-sm flex-1"
            >
              View Health Packages
            </a>
            <a
              href="/search"
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-white text-[#4B0082] font-bold rounded-xl shadow-lg active:scale-[0.97] transition-all text-sm flex-1"
            >
              Book a Test Now
            </a>
          </div>

          {/* Mobile trust badges */}
          <TrustBadges className="justify-center" />
        </div>
      </div>

      {/* ─── Carousel Dots ─── */}
      {slides.length > 1 && (
        <div className="relative z-10 pb-4 md:pb-5">
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
        <div className="hidden md:block">
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

      {/* ─── Preload Next Image (hidden) ─── */}
      {nextSlide && (
        <img
          src={nextSlide.desktopImageUrl || nextSlide.mobileImageUrl || ''}
          alt=""
          aria-hidden="true"
          className="absolute w-0 h-0 opacity-0 pointer-events-none"
        />
      )}
    </section>
  );
}
