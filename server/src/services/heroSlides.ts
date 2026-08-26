import { prisma } from '../db';
import { logger } from '../utils/logger';

export interface HeroSlideData {
  id?: string;
  title: string;
  subtitle: string;
  badgeText?: string | null;
  ctaText: string;
  ctaLink: string;
  secondaryCtaText?: string | null;
  secondaryCtaLink?: string | null;
  imageUrl?: string | null;
  desktopImageUrl?: string | null;
  mobileImageUrl?: string | null;
  imageAlt?: string | null;
  bgGradient: string;
  sortOrder: number;
  isActive: boolean;
}

export const DEFAULT_HERO_SLIDES: HeroSlideData[] = [
  {
    id: 'default-slide-1',
    title: 'Precision Diagnostics, Delivered to Your Door.',
    subtitle: 'Get NABL & CAP certified lab tests and health checkups at home. Fast, accurate results you can trust.',
    badgeText: '100% SECURE & ACCREDITED',
    ctaText: 'Book a Test',
    ctaLink: '/search',
    secondaryCtaText: 'Explore Packages',
    secondaryCtaLink: '/packages',
    imageUrl: null,
    bgGradient: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)',
    sortOrder: 0,
    isActive: true,
  },
  {
    id: 'default-slide-2',
    title: 'Full Body Health Packages Up To 40% OFF',
    subtitle: 'Comprehensive 60+ parameter health checkups with free home sample collection across 100+ cities.',
    badgeText: 'SPECIAL OFFER • LIMITED TIME',
    ctaText: 'View Packages',
    ctaLink: '/packages',
    secondaryCtaText: 'Book Callback',
    secondaryCtaLink: '/#callback',
    imageUrl: null,
    bgGradient: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #1E3A8A 25.49%, #0F172A 74.17%)',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 'default-slide-3',
    title: 'Community Health Camps Near You',
    subtitle: 'Join our ongoing wellness initiatives for discounted group testing, health counseling, and rapid report delivery.',
    badgeText: 'COMMUNITY WELLNESS INITIATIVE',
    ctaText: 'Find Nearby Camp',
    ctaLink: '/camps',
    secondaryCtaText: 'Contact Support',
    secondaryCtaLink: '/about',
    imageUrl: null,
    bgGradient: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #065F46 25.49%, #022C22 74.17%)',
    sortOrder: 2,
    isActive: true,
  },
];

/**
 * Ensures default slides exist in DB if empty.
 */
export async function seedDefaultHeroSlidesIfEmpty() {
  try {
    const count = await prisma.heroSlide.count();
    if (count === 0) {
      logger.info({}, 'Seeding initial default hero slides into database...');
      for (const slide of DEFAULT_HERO_SLIDES) {
        await prisma.heroSlide.create({
          data: {
            title: slide.title,
            subtitle: slide.subtitle,
            badgeText: slide.badgeText,
            ctaText: slide.ctaText,
            ctaLink: slide.ctaLink,
            secondaryCtaText: slide.secondaryCtaText,
            secondaryCtaLink: slide.secondaryCtaLink,
            imageUrl: slide.imageUrl,
            bgGradient: slide.bgGradient,
            sortOrder: slide.sortOrder,
            isActive: slide.isActive,
          },
        });
      }
    }
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Failed to seed hero slides (using fallback)');
  }
}

/**
 * Fetch active slides for public landing page.
 * Returns empty array if none exist — frontend handles fallback.
 */
export async function getPublicHeroSlides() {
  try {
    const slides = await prisma.heroSlide.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return slides;
  } catch (error: any) {
    logger.warn({ error: error.message }, 'Database error fetching hero slides');
    return [];
  }
}
