import { Response } from 'express';
import { CatalogItemType } from '@prisma/client';
import { prisma } from '../../db';
import { AuthRequest } from '../../middleware/auth';
import { buildCatalogSearchWhere } from '../../utils/searchUtils';

/** Type filter: packages admin only manages PACKAGE and PROFILE items */
const PACKAGE_TYPES: CatalogItemType[] = ['PACKAGE', 'PROFILE'];

/**
 * GET /api/admin/featured-packages
 * List all featured packages (PACKAGE + PROFILE only)
 */
export const listFeaturedPackages = async (req: AuthRequest, res: Response) => {
    try {
        const items = await prisma.catalogItem.findMany({
            where: { isFeatured: true, type: { in: PACKAGE_TYPES } },
            orderBy: { featuredOrder: 'asc' },
            include: {
                categories: {
                    include: { category: { select: { id: true, name: true } } }
                }
            }
        });

        const formatted = items.map((item: any) => ({
            id: item.id,
            partnerCode: item.partnerCode,
            name: item.name,
            type: item.type,
            displayPrice: item.displayPrice,
            discountedPrice: item.discountedPrice,
            isEnabled: item.isEnabled,
            isFeatured: item.isFeatured,
            featuredOrder: item.featuredOrder,
            categories: item.categories.map((c: any) => c.category)
        }));

        res.json({ products: formatted });
    } catch (error: any) {
        console.error('[Admin] Error listing featured packages:', error.message);
        res.status(500).json({ error: 'Failed to fetch featured packages' });
    }
};

/**
 * GET /api/admin/featured-packages/search
 * Search/browse non-featured packages with pagination
 */
export const searchCatalogForFeaturing = async (req: AuthRequest, res: Response) => {
    const { q, search, page = '1', limit = '20' } = req.query;
    const searchTerm = (q || search) as string | undefined;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    try {
        const where: any = {
            isFeatured: false,
            type: { in: PACKAGE_TYPES },
        };
        if (searchTerm && searchTerm.trim().length >= 1) {
            const searchClause = buildCatalogSearchWhere(searchTerm);
            where.OR = searchClause.OR;
        }

        const [items, totalCount] = await Promise.all([
            prisma.catalogItem.findMany({
                where,
                skip,
                take: limitNum,
                orderBy: { name: 'asc' },
                select: {
                    id: true,
                    partnerCode: true,
                    name: true,
                    type: true,
                    displayPrice: true,
                    discountedPrice: true,
                }
            }),
            prisma.catalogItem.count({ where }),
        ]);

        res.json({
            products: items,
            totalCount,
            totalPages: Math.ceil(totalCount / limitNum),
            page: pageNum,
        });
    } catch (error: any) {
        console.error('[Admin] Error searching catalog:', error.message);
        res.status(500).json({ error: 'Failed to search catalog' });
    }
};

/**
 * POST /api/admin/featured-packages
 * Add one or more items to featured packages
 * Body: { catalogItemIds: string[] } OR { catalogItemId: string } (legacy)
 */
export const addFeaturedPackage = async (req: AuthRequest, res: Response) => {
    const { catalogItemIds, catalogItemId } = req.body;
    const ids: string[] = catalogItemIds || (catalogItemId ? [catalogItemId] : []);

    if (!ids.length) {
        return res.status(400).json({ error: 'catalogItemIds is required' });
    }

    try {
        const maxOrderResult = await prisma.catalogItem.aggregate({
            where: { isFeatured: true, type: { in: PACKAGE_TYPES } },
            _max: { featuredOrder: true }
        });
        
        let nextOrder = (maxOrderResult._max?.featuredOrder || 0) + 1;

        await prisma.$transaction(
            ids.map((id) =>
                prisma.catalogItem.update({
                    where: { id },
                    data: {
                        isFeatured: true,
                        featuredOrder: nextOrder++
                    }
                })
            )
        );

        res.json({ message: `${ids.length} package(s) featured successfully` });
    } catch (error: any) {
        console.error('[Admin] Error adding featured package:', error.message);
        res.status(500).json({ error: 'Failed to add featured package' });
    }
};

/**
 * DELETE /api/admin/featured-packages/:id
 * Remove an item from featured packages
 */
export const removeFeaturedPackage = async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    try {
        const updated = await prisma.catalogItem.update({
            where: { id },
            data: {
                isFeatured: false,
                featuredOrder: null
            }
        });

        res.json({ message: 'Package removed from featured successfully', product: updated });
    } catch (error: any) {
        console.error('[Admin] Error removing featured package:', error.message);
        res.status(500).json({ error: 'Failed to remove featured package' });
    }
};

/**
 * PUT /api/admin/featured-packages/reorder
 * Reorder featured packages
 * Body: { orderedIds: string[] }
 */
export const reorderFeaturedPackages = async (req: AuthRequest, res: Response) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: 'orderedIds must be an array of strings' });
    }

    try {
        await prisma.$transaction(
            orderedIds.map((id, index) => 
                prisma.catalogItem.update({
                    where: { id },
                    data: { featuredOrder: index + 1 }
                })
            )
        );

        res.json({ message: 'Reordered successfully' });
    } catch (error: any) {
        console.error('[Admin] Error reordering featured packages:', error.message);
        res.status(500).json({ error: 'Failed to reorder featured packages' });
    }
};

/**
 * PUT /api/admin/featured-packages/:id/toggle
 * Toggle enabled status of a featured package
 */
export const toggleFeaturedActive = async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { isEnabled } = req.body;

    if (typeof isEnabled !== 'boolean') {
        return res.status(400).json({ error: 'isEnabled is required and must be a boolean' });
    }

    try {
        const updated = await prisma.catalogItem.update({
            where: { id },
            data: { isEnabled }
        });

        res.json({ message: 'Status updated successfully', product: updated });
    } catch (error: any) {
        console.error('[Admin] Error toggling featured package status:', error.message);
        res.status(500).json({ error: 'Failed to toggle status' });
    }
};
