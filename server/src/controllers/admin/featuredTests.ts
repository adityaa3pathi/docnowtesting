import { Response } from 'express';
import { prisma } from '../../db';
import { AuthRequest } from '../../middleware/auth';
import { buildCatalogSearchWhere } from '../../utils/searchUtils';

/**
 * GET /api/admin/featured-tests
 * List all featured tests (TEST type only)
 */
export const listFeaturedTests = async (req: AuthRequest, res: Response) => {
    try {
        const items = await prisma.catalogItem.findMany({
            where: { isFeatured: true, type: 'TEST' },
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
        console.error('[Admin] Error listing featured tests:', error.message);
        res.status(500).json({ error: 'Failed to fetch featured tests' });
    }
};

/**
 * GET /api/admin/featured-tests/search
 * Search/browse non-featured tests with pagination
 */
export const searchTestsForFeaturing = async (req: AuthRequest, res: Response) => {
    const { search, page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    try {
        const where: any = {
            isFeatured: false,
            type: 'TEST',
        };
        if (search && (search as string).trim().length >= 1) {
            const searchClause = buildCatalogSearchWhere(search as string);
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
        console.error('[Admin] Error searching tests:', error.message);
        res.status(500).json({ error: 'Failed to search tests' });
    }
};

/**
 * POST /api/admin/featured-tests
 * Add one or more tests to featured
 * Body: { catalogItemIds: string[] } OR { catalogItemId: string } (legacy)
 */
export const addFeaturedTest = async (req: AuthRequest, res: Response) => {
    const { catalogItemIds, catalogItemId } = req.body;
    const ids: string[] = catalogItemIds || (catalogItemId ? [catalogItemId] : []);

    if (!ids.length) {
        return res.status(400).json({ error: 'catalogItemIds is required' });
    }

    try {
        const maxOrderResult = await prisma.catalogItem.aggregate({
            where: { isFeatured: true, type: 'TEST' },
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

        res.json({ message: `${ids.length} test(s) featured successfully` });
    } catch (error: any) {
        console.error('[Admin] Error adding featured test:', error.message);
        res.status(500).json({ error: 'Failed to add featured test' });
    }
};

/**
 * DELETE /api/admin/featured-tests/:id
 * Remove a test from featured tests
 */
export const removeFeaturedTest = async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    try {
        const updated = await prisma.catalogItem.update({
            where: { id },
            data: {
                isFeatured: false,
                featuredOrder: null
            }
        });

        res.json({ message: 'Test removed from featured successfully', product: updated });
    } catch (error: any) {
        console.error('[Admin] Error removing featured test:', error.message);
        res.status(500).json({ error: 'Failed to remove featured test' });
    }
};

/**
 * PUT /api/admin/featured-tests/reorder
 * Reorder featured tests
 * Body: { orderedIds: string[] }
 */
export const reorderFeaturedTests = async (req: AuthRequest, res: Response) => {
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
        console.error('[Admin] Error reordering featured tests:', error.message);
        res.status(500).json({ error: 'Failed to reorder featured tests' });
    }
};

/**
 * PUT /api/admin/featured-tests/:id/toggle
 * Toggle enabled status of a featured test
 */
export const toggleFeaturedTestActive = async (req: AuthRequest, res: Response) => {
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
        console.error('[Admin] Error toggling featured test status:', error.message);
        res.status(500).json({ error: 'Failed to toggle status' });
    }
};
