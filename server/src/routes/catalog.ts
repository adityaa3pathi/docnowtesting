import { Router, Response, Request } from 'express';
import { prisma } from '../db';

const router = Router();

// ============================================
// GET /api/catalog/products
// User-facing: returns enabled items with manager-set prices
// ============================================
router.get('/products', async (req: Request, res: Response) => {
    const { type, search, category, zipcode } = req.query;

    console.log('[Catalog] GET /api/catalog/products — query params:', { type, search, category, zipcode });

    const where: any = { isEnabled: true };
    if (type) where.type = type;
    if (search) where.name = { contains: search as string, mode: 'insensitive' };
    if (category) {
        where.categories = {
            some: { category: { slug: category as string, isActive: true } }
        };
    }

    try {
        const items = await prisma.catalogItem.findMany({
            where,
            include: {
                categories: {
                    include: {
                        category: { select: { id: true, name: true, slug: true } }
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        // Flatten categories in response
        const formatted = items.map(item => ({
            id: item.id,
            partnerCode: item.partnerCode,
            name: item.name,
            type: item.type,
            displayPrice: item.displayPrice,
            discountedPrice: item.discountedPrice,
            description: item.description,
            parameters: item.parameters,
            sampleType: item.sampleType,
            reportTime: item.reportTime,
            price: item.discountedPrice ?? item.displayPrice,
            mrp: item.discountedPrice ? item.displayPrice : null,
            categories: item.categories.map(c => c.category)
        }));

        console.log(`[Catalog] Response: ${formatted.length} products returned`);
        console.log('[Catalog] Full response:', JSON.stringify({ products: formatted }, null, 2));

        res.json({ products: formatted });
    } catch (error: any) {
        console.error('[Catalog] Error fetching products:', error.message);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// ============================================
// GET /api/catalog/products/:code
// Single product detail by partnerCode
// ============================================
router.get('/products/:code', async (req: Request, res: Response) => {
    try {
        const code = req.params.code as string;
        const item = await prisma.catalogItem.findUnique({
            where: { partnerCode: code },
            include: {
                categories: {
                    include: { category: { select: { id: true, name: true, slug: true } } }
                }
            }
        });

        if (!item || !item.isEnabled) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json({
            ...item,
            price: item.discountedPrice ?? item.displayPrice,
            mrp: item.discountedPrice ? item.displayPrice : null,
            categories: item.categories.map((c: any) => c.category)
        });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// ============================================
// GET /api/catalog/categories
// User-facing: active categories with enabled items
// ============================================
router.get('/categories', async (req: Request, res: Response) => {
    try {
        const categories = await prisma.category.findMany({
            where: { isActive: true },
            include: {
                items: {
                    where: { catalogItem: { isEnabled: true } },
                    include: {
                        catalogItem: {
                            select: {
                                id: true,
                                partnerCode: true,
                                name: true,
                                type: true,
                                displayPrice: true,
                                discountedPrice: true,
                                description: true,
                                parameters: true,
                                sampleType: true,
                                reportTime: true
                            }
                        }
                    },
                    orderBy: { sortOrder: 'asc' }
                }
            },
            orderBy: { sortOrder: 'asc' }
        });

        const formatted = categories.map(cat => ({
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description,
            items: cat.items.map(i => ({
                ...i.catalogItem,
                price: i.catalogItem.discountedPrice ?? i.catalogItem.displayPrice,
                mrp: i.catalogItem.discountedPrice ? i.catalogItem.displayPrice : null
            }))
        }));

        res.json({ categories: formatted });
    } catch (error: any) {
        console.error('[Catalog] Error fetching categories:', error.message);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

export default router;
