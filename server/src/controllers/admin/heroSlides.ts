import { Response } from 'express';
import { prisma } from '../../db';
import { seedDefaultHeroSlidesIfEmpty } from '../../services/heroSlides';
import { AuthRequest } from '../../middleware/auth';

/**
 * List all hero slides for Admin CMS
 */
export async function listHeroSlides(req: AuthRequest, res: Response) {
  try {
    await seedDefaultHeroSlidesIfEmpty();
    const slides = await prisma.heroSlide.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ slides });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch hero slides' });
  }
}

/**
 * Create a new hero slide
 */
export async function createHeroSlide(req: AuthRequest, res: Response) {
  try {
    const {
      title,
      subtitle,
      badgeText,
      ctaText = 'Book a Test',
      ctaLink = '/search',
      secondaryCtaText,
      secondaryCtaLink,
      imageUrl,
      bgGradient = 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)',
      sortOrder,
      isActive = true,
    } = req.body;

    if (!title || !subtitle) {
      return res.status(400).json({ error: 'Title and subtitle are required' });
    }

    let calculatedSortOrder = sortOrder;
    if (calculatedSortOrder === undefined || calculatedSortOrder === null) {
      const maxSlide = await prisma.heroSlide.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      calculatedSortOrder = (maxSlide?.sortOrder ?? -1) + 1;
    }

    const slide = await prisma.heroSlide.create({
      data: {
        title,
        subtitle,
        badgeText: badgeText || null,
        ctaText,
        ctaLink,
        secondaryCtaText: secondaryCtaText || null,
        secondaryCtaLink: secondaryCtaLink || null,
        imageUrl: imageUrl || null,
        bgGradient,
        sortOrder: calculatedSortOrder,
        isActive: Boolean(isActive),
      },
    });

    if (req.userId) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: req.userId,
          adminName: req.adminName || 'Admin',
          action: 'HERO_SLIDE_CREATE',
          entity: 'HeroSlide',
          targetId: slide.id,
          newValue: slide,
        },
      });
    }

    res.status(201).json({ slide });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create hero slide: ' + error.message });
  }
}

/**
 * Update an existing hero slide
 */
export async function updateHeroSlide(req: AuthRequest, res: Response) {
  try {
    const id = req.params.id as string;
    const {
      title,
      subtitle,
      badgeText,
      ctaText,
      ctaLink,
      secondaryCtaText,
      secondaryCtaLink,
      imageUrl,
      bgGradient,
      sortOrder,
      isActive,
    } = req.body;

    const existing = await prisma.heroSlide.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Hero slide not found' });
    }

    const updated = await prisma.heroSlide.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(subtitle !== undefined && { subtitle }),
        ...(badgeText !== undefined && { badgeText: badgeText || null }),
        ...(ctaText !== undefined && { ctaText }),
        ...(ctaLink !== undefined && { ctaLink }),
        ...(secondaryCtaText !== undefined && { secondaryCtaText: secondaryCtaText || null }),
        ...(secondaryCtaLink !== undefined && { secondaryCtaLink: secondaryCtaLink || null }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
        ...(bgGradient !== undefined && { bgGradient }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    if (req.userId) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: req.userId,
          adminName: req.adminName || 'Admin',
          action: 'HERO_SLIDE_UPDATE',
          entity: 'HeroSlide',
          targetId: id,
          oldValue: existing,
          newValue: updated,
        },
      });
    }

    res.json({ slide: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update hero slide: ' + error.message });
  }
}

/**
 * Toggle active status
 */
export async function toggleHeroSlideActive(req: AuthRequest, res: Response) {
  try {
    const id = req.params.id as string;
    const existing = await prisma.heroSlide.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Hero slide not found' });
    }

    const updated = await prisma.heroSlide.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    res.json({ slide: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to toggle slide status' });
  }
}

/**
 * Delete a hero slide
 */
export async function deleteHeroSlide(req: AuthRequest, res: Response) {
  try {
    const id = req.params.id as string;
    const existing = await prisma.heroSlide.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Hero slide not found' });
    }

    await prisma.heroSlide.delete({ where: { id } });

    if (req.userId) {
      await prisma.adminAuditLog.create({
        data: {
          adminId: req.userId,
          adminName: req.adminName || 'Admin',
          action: 'HERO_SLIDE_DELETE',
          entity: 'HeroSlide',
          targetId: id,
          oldValue: existing,
          isDestructive: true,
        },
      });
    }

    res.json({ success: true, deletedId: id });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete hero slide' });
  }
}

/**
 * Reorder hero slides
 * Body: { items: [{ id: string, sortOrder: number }] }
 */
export async function reorderHeroSlides(req: AuthRequest, res: Response) {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    await prisma.$transaction(
      items.map((item: { id: string; sortOrder: number }) =>
        prisma.heroSlide.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to reorder hero slides' });
  }
}
