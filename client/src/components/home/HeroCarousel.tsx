'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
 * Full-Bleed Hero Carousel — Client Island
 *
 * Renders CMS-managed banner images as the full background of the hero section
 * on md: screens and up (≥768px). On mobile, returns null so the server-rendered
 * purple gradient shows through. Failed images are silently removed from rotation.
 */
export function HeroCarousel() {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch slides from API
  useEffect(() => {
    async function fetchSlides() {
      try {
        const res = await api.get('/hero-slides');
        if (res.data?.slides?.length > 0) {
          const withImages = res.data.slides.filter(
            (s: HeroSlide) => s.desktopImageUrl
          );
          if (withImages.length > 0) setSlides(withImages);
        }
      } catch {
        // Fallback: hero section displays default purple gradient
      }
    }
    fetchSlides();
  }, []);

  // Compute valid slides (exclude failed ones)
  const validSlides = slides.filter((s) => !failedIds.has(s.id));

  // Handle image load success
  const handleImageLoad = useCallback((id: string) => {
    setLoadedIds((prev) => new Set(prev).add(id));
  }, []);

  // Handle image load failure — silently remove from rotation
  const handleImageError = useCallback((id: string) => {
    setFailedIds((prev) => new Set(prev).add(id));
  }, []);

  // Auto-play (5.5s interval) — no pause on hover
  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % Math.max(validSlides.length, 1));
  }, [validSlides.length]);

  useEffect(() => {
    if (validSlides.length <= 1) return;
    timerRef.current = setInterval(handleNext, 5500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [validSlides.length, handleNext]);

  // Reset index if it goes out of bounds after a slide is removed
  useEffect(() => {
    if (validSlides.length > 0 && currentIndex >= validSlides.length) {
      setCurrentIndex(0);
    }
  }, [validSlides.length, currentIndex]);

  // No valid slides — return null, let the purple gradient show
  if (validSlides.length === 0) {
    return null;
  }

  return (
    <div
      className="hidden md:block absolute inset-0 overflow-hidden z-0"
      aria-label="Hero banner carousel"
    >
      {/* All slide images stacked — crossfade via opacity */}
      {validSlides.map((slide, idx) => (
        <img
          key={slide.id}
          src={slide.desktopImageUrl || ''}
          alt={slide.imageAlt || 'Healthcare banner'}
          loading={idx === 0 ? 'eager' : 'lazy'}
          onLoad={() => handleImageLoad(slide.id)}
          onError={() => handleImageError(slide.id)}
          className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ease-in-out ${
            idx === currentIndex && loadedIds.has(slide.id)
              ? 'opacity-100'
              : 'opacity-0'
          }`}
        />
      ))}

      {/* Dark overlay for text readability — left-heavy gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/30 to-transparent z-[1]" />

      {/* Dot indicators */}
      {validSlides.length > 1 && (
        <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-2 z-[2]">
          {validSlides.map((_, idx) => (
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
