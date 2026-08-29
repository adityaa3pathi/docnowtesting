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

/**
 * Desktop Hero Carousel — Client Island
 * 
 * Renders dynamically loaded CMS slides on the right side of the hero section
 * on desktop viewports (lg and up). When no slides are uploaded or available,
 * returns null to ensure the hero background is 100% seamless with zero shade distortion.
 */
export function HeroCarousel() {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
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
        // Fallback: hero section displays default pure gradient background
      } finally {
        setIsLoading(false);
      }
    }
    fetchSlides();
  }, []);

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

  // Auto-play (5.5s interval)
  useEffect(() => {
    if (isPaused || slides.length <= 1) return;
    timerRef.current = setInterval(handleNext, 5500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, slides.length, handleNext]);

  // When no slides are configured or still loading with no data, return null
  if (slides.length === 0) {
    return null;
  }

  const current = slides[currentIndex] || slides[0];

  return (
    <div
      className="hidden lg:block absolute top-0 right-0 bottom-0 w-[45%] overflow-hidden z-10 pointer-events-auto"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      aria-label="Hero banner carousel"
    >
      {/* Slide image */}
      {!imgError && (
        <img
          key={current.id}
          src={current.desktopImageUrl || current.mobileImageUrl || ''}
          alt={current.imageAlt || 'Doctor and healthcare professional'}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          className={`w-full h-full object-cover object-center transition-opacity duration-500 ease-in-out ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Desktop Navigation Arrows */}
      {slides.length > 1 && imgLoaded && (
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 flex items-center justify-between pointer-events-none z-20">
          <button
            onClick={handlePrev}
            aria-label="Previous slide"
            className="pointer-events-auto p-2.5 rounded-full bg-black/25 hover:bg-black/45 active:scale-95 text-white backdrop-blur-md transition-all shadow-md"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={handleNext}
            aria-label="Next slide"
            className="pointer-events-auto p-2.5 rounded-full bg-black/25 hover:bg-black/45 active:scale-95 text-white backdrop-blur-md transition-all shadow-md"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {/* Slide Indicator Dots */}
      {slides.length > 1 && imgLoaded && (
        <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-2 z-20">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                idx === currentIndex
                  ? 'w-7 bg-white shadow-sm'
                  : 'w-2 bg-white/40 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
