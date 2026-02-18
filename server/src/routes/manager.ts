import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireManager } from '../middleware/requireManager';
import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';

const router = Router();
const healthians = HealthiansAdapter.getInstance();

// All manager routes require auth + MANAGER/SUPER_ADMIN role
const mgr = [authMiddleware, requireManager] as const;

// Health check — verifies MANAGER/SUPER_ADMIN access for frontend auth guard
router.get('/health', ...mgr, async (req: AuthRequest, res: Response) => {
    res.json({ ok: true, manager: req.adminName || 'Manager', role: (req as any).user?.role });
});

// ============================================
// CATALOG SYNC — Import from Healthians
// ============================================

/**
 * POST /api/manager/catalog/sync
 * Fetches products from Healthians and upserts into CatalogItem.
 * New items get partnerPrice = displayPrice (manager can adjust later).
 * Existing items: only partnerPrice and metadata are updated.
 */
router.post('/catalog/sync', ...mgr, async (req: AuthRequest, res: Response) => {
    const { zipcode } = req.body;

    if (!zipcode) {
        return res.status(400).json({ error: 'zipcode is required for sync' });
    }

    try {
        const response = await healthians.getPartnerProducts(zipcode);
        const products = response?.data || response?.products || response || [];

        if (!Array.isArray(products)) {
            return res.status(400).json({ error: 'Unexpected response format from Healthians', raw: response });
        }

        let created = 0;
        let updated = 0;

        for (const product of products) {
            // Normalize Healthians response fields
            const partnerCode = String(product.deal_id || `${product.product_type}_${product.product_type_id}` || product.id);
            const name = product.test_name || product.name || product.deal_name || 'Unknown';
            const price = parseFloat(product.price || product.mrp || '0');
            const type = normalizeType(product.product_type || product.deal_type);

            const existing = await prisma.catalogItem.findUnique({
                where: { partnerCode }
            });

            if (existing) {
                // Update partner price + metadata only; keep manager overrides
                await prisma.catalogItem.update({
                    where: { partnerCode },
                    data: {
                        partnerPrice: price,
                        name: name,
                        type: type,
                        description: product.description || existing.description,
                        parameters: product.parameters || product.parameter_count?.toString() || existing.parameters,
                        sampleType: product.sample_type || existing.sampleType,
                        reportTime: product.report_time || product.report_tat || existing.reportTime,
                        partnerData: product
                    }
                });
                updated++;
            } else {
                // New item: displayPrice defaults to partner price
                await prisma.catalogItem.create({
                    data: {
                        partnerCode,
                        name,
                        type,
                        partnerPrice: price,
                        displayPrice: price,  // Default: can be overridden by manager
                        description: product.description || null,
                        parameters: product.parameters || product.parameter_count?.toString() || null,
                        sampleType: product.sample_type || null,
                        reportTime: product.report_time || product.report_tat || null,
                        partnerData: product,
                        isEnabled: true  // Products are available globally per Healthians confirmation
                    }
                });
                created++;
            }
        }

        res.json({
            message: `Sync complete: ${created} created, ${updated} updated`,
            total: products.length,
            created,
            updated
        });
    } catch (error: any) {
        console.error('[Manager] Catalog sync error:', error.message);
        res.status(500).json({ error: 'Failed to sync catalog', details: error.message });
    }
});

// ============================================
// CATALOG CRUD
// ============================================

/**
 * GET /api/manager/catalog
 * List all catalog items with filters.
 */
router.get('/catalog', ...mgr, async (req: AuthRequest, res: Response) => {
    const { type, enabled, search, page = '1', limit = '50' } = req.query;

    const where: any = {};
    if (type) where.type = type;
    if (enabled !== undefined) where.isEnabled = enabled === 'true';
    if (search) where.name = { contains: search as string, mode: 'insensitive' };

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    try {
        const [items, total] = await Promise.all([
            prisma.catalogItem.findMany({
                where,
                include: {
                    categories: {
                        include: { category: { select: { id: true, name: true, slug: true } } }
                    }
                },
                orderBy: { name: 'asc' },
                skip,
                take: parseInt(limit as string)
            }),
            prisma.catalogItem.count({ where })
        ]);

        res.json({ items, total, page: parseInt(page as string), limit: parseInt(limit as string) });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch catalog', details: error.message });
    }
});

/**
 * PUT /api/manager/catalog/:id
 * Update a catalog item (price, discount, enable/disable, metadata).
 */
router.put('/catalog/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { displayPrice, discountedPrice, isEnabled, name, description, parameters, sampleType, reportTime, type } = req.body;

    try {
        const existing = await prisma.catalogItem.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Catalog item not found' });

        const data: any = {};
        if (displayPrice !== undefined) data.displayPrice = parseFloat(displayPrice);
        if (discountedPrice !== undefined) data.discountedPrice = discountedPrice === null ? null : parseFloat(discountedPrice);
        if (isEnabled !== undefined) data.isEnabled = Boolean(isEnabled);
        if (name !== undefined) data.name = name;
        if (description !== undefined) data.description = description;
        if (parameters !== undefined) data.parameters = parameters;
        if (sampleType !== undefined) data.sampleType = sampleType;
        if (reportTime !== undefined) data.reportTime = reportTime;
        if (type !== undefined) data.type = type;

        const updated = await prisma.catalogItem.update({
            where: { id },
            data,
            include: {
                categories: {
                    include: { category: { select: { id: true, name: true } } }
                }
            }
        });

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update catalog item', details: error.message });
    }
});

/**
 * PUT /api/manager/catalog/:id/toggle
 * Quick enable/disable toggle.
 */
router.put('/catalog/:id/toggle', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    try {
        const existing = await prisma.catalogItem.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Catalog item not found' });

        const updated = await prisma.catalogItem.update({
            where: { id },
            data: { isEnabled: !existing.isEnabled }
        });

        res.json({ id: updated.id, name: updated.name, isEnabled: updated.isEnabled });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to toggle item', details: error.message });
    }
});

// ============================================
// CATEGORY CRUD
// ============================================

/**
 * POST /api/manager/categories
 */
router.post('/categories', ...mgr, async (req: AuthRequest, res: Response) => {
    const { name, description, sortOrder } = req.body;

    if (!name) return res.status(400).json({ error: 'Category name is required' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    try {
        const category = await prisma.category.create({
            data: { name, slug, description: description || null, sortOrder: sortOrder || 0 }
        });
        res.status(201).json(category);
    } catch (error: any) {
        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'Category with this name already exists' });
        }
        res.status(500).json({ error: 'Failed to create category', details: error.message });
    }
});

/**
 * GET /api/manager/categories
 */
router.get('/categories', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const categories = await prisma.category.findMany({
            include: {
                items: {
                    include: {
                        catalogItem: { select: { id: true, name: true, partnerCode: true, isEnabled: true } }
                    },
                    orderBy: { sortOrder: 'asc' }
                }
            },
            orderBy: { sortOrder: 'asc' }
        });

        // Add item count
        const result = categories.map(cat => ({
            ...cat,
            itemCount: cat.items.length,
            enabledItemCount: cat.items.filter(i => i.catalogItem.isEnabled).length
        }));

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
    }
});

/**
 * PUT /api/manager/categories/:id
 */
router.put('/categories/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { name, description, sortOrder, isActive } = req.body;

    try {
        const data: any = {};
        if (name !== undefined) {
            data.name = name;
            data.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }
        if (description !== undefined) data.description = description;
        if (sortOrder !== undefined) data.sortOrder = sortOrder;
        if (isActive !== undefined) data.isActive = Boolean(isActive);

        const updated = await prisma.category.update({ where: { id }, data });
        res.json(updated);
    } catch (error: any) {
        if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
        res.status(500).json({ error: 'Failed to update category', details: error.message });
    }
});

/**
 * DELETE /api/manager/categories/:id
 */
router.delete('/categories/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    try {
        await prisma.category.delete({ where: { id } });
        res.json({ message: 'Category deleted' });
    } catch (error: any) {
        if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
        res.status(500).json({ error: 'Failed to delete category', details: error.message });
    }
});

// ============================================
// CATEGORY ↔ ITEM ASSIGNMENT
// ============================================

/**
 * POST /api/manager/categories/:id/items
 * Body: { itemIds: string[] }
 */
router.post('/categories/:id/items', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({ error: 'itemIds array is required' });
    }

    try {
        const category = await prisma.category.findUnique({ where: { id } });
        if (!category) return res.status(404).json({ error: 'Category not found' });

        // Upsert to avoid duplicates
        const results = await Promise.all(
            itemIds.map(catalogItemId =>
                prisma.catalogItemCategory.upsert({
                    where: {
                        catalogItemId_categoryId: { catalogItemId, categoryId: id }
                    },
                    create: { catalogItemId, categoryId: id },
                    update: {}
                })
            )
        );

        res.json({ message: `${results.length} items assigned to category "${category.name}"` });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to assign items', details: error.message });
    }
});

/**
 * DELETE /api/manager/categories/:id/items
 * Body: { itemIds: string[] }
 */
router.delete('/categories/:id/items', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({ error: 'itemIds array is required' });
    }

    try {
        const deleted = await prisma.catalogItemCategory.deleteMany({
            where: {
                categoryId: id,
                catalogItemId: { in: itemIds }
            }
        });

        res.json({ message: `${deleted.count} items removed from category` });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to remove items', details: error.message });
    }
});

// ============================================
// HELPERS
// ============================================

function normalizeType(dealType?: string): 'TEST' | 'PACKAGE' | 'PROFILE' {
    if (!dealType) return 'TEST';
    const t = dealType.toLowerCase();
    if (t === 'package' || t === 'combo') return 'PACKAGE';
    if (t === 'profile') return 'PROFILE';
    return 'TEST';
}

export default router;
