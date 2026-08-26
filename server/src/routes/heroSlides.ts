import { Router, Request, Response } from 'express';
import { getPublicHeroSlides } from '../services/heroSlides';
import { refreshPresignedUrl } from '../services/imageUpload';

const router = Router();

/**
 * GET /api/hero-slides
 * Public endpoint to fetch active hero slides for landing page carousel.
 * Generates fresh presigned URLs for each slide's images.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const slides = await getPublicHeroSlides();

    // Generate fresh presigned URLs from S3 keys
    const slidesWithUrls = await Promise.all(
      slides.map(async (slide: any) => {
        const result = { ...slide };
        try {
          if (slide.desktopImageKey) {
            result.desktopImageUrl = await refreshPresignedUrl(slide.desktopImageKey);
          }
          if (slide.mobileImageKey) {
            result.mobileImageUrl = await refreshPresignedUrl(slide.mobileImageKey);
          }
        } catch (err) {
          // If presigning fails, keep whatever URL was stored
        }
        return result;
      })
    );

    res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    res.json({ slides: slidesWithUrls });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch hero slides' });
  }
});

export default router;
