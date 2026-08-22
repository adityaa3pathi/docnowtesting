'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
          // Only use slides that have at least one image
          const withImages = res.data.slides.filter(
            (s: HeroSlide) => s.desktopImageUrl || s.mobileImageUrl
          );
          if (withImages.length > 0) setSlides(withImages);
        }
      } catch {
        // No slides — carousel simply won't render
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
    timerRef.current = setInterval(handleNext, 5000);
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

  // Nothing to show
  if (slides.length === 0) return null;

  const current = slides[currentIndex] || slides[0];

  return (
    <section
      className="relative w-full overflow-hidden bg-gray-900"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Aspect-ratio container — 18:7 on desktop, 8:5 on mobile */}
      <div className="relative w-full" style={{ paddingBottom: 'clamp(38.89%, 50vw, 62.5%)' }}>
        {/* Desktop image */}
        {(current.desktopImageUrl) && (
          <img
            key={`desktop-${current.id}`}
            src={current.desktopImageUrl}
            alt={current.imageAlt || 'Hero banner'}
            className="hidden md:block absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700"
          />
        )}
        {/* Mobile image */}
        {(current.mobileImageUrl || current.desktopImageUrl) && (
          <img
            key={`mobile-${current.id}`}
            src={current.mobileImageUrl || current.desktopImageUrl!}
            alt={current.imageAlt || 'Hero banner'}
            className="block md:hidden absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700"
          />
        )}
      </div>

      {/* Controls */}
      {slides.length > 1 && (
        <>
          {/* Dots */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Go to slide ${idx + 1}`}
                className={`h-2.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex
                    ? 'w-8 bg-white'
                    : 'w-2.5 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>

          {/* Arrows */}
          <button
            onClick={handlePrev}
            aria-label="Previous slide"
            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition-all z-10"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={handleNext}
            aria-label="Next slide"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition-all z-10"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </section>
  );
}
