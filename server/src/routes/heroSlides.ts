import { Router, Request, Response } from 'express';
import { getPublicHeroSlides } from '../services/heroSlides';

const router = Router();

/**
 * GET /api/hero-slides
 * Public endpoint to fetch active hero slides for landing page carousel.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const slides = await getPublicHeroSlides();
    res.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
    res.json({ slides });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch hero slides' });
  }
});

export default router;
