import { Router, Response, Request } from 'express';
import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';
import { buildCatalogSearchWhere, rankSearchResults } from '../utils/searchUtils';
import { buildDetailsSummary, hydrateCatalogDetails } from '../services/catalogDetails';
import { getOrSetJsonCache, hashCacheValue } from '../utils/cache';

const router = Router();

// ============================================
// GET /api/catalog/products
// User-facing: paginated, filterable, searchable
// ============================================
router.get('/products', async (req: Request, res: Response) => {
    const { type, search, category, zipcode, page = '1', limit = '12' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 12));
    const skip = (pageNum - 1) * limitNum;
    const cacheKey = `catalog:products:v1:${hashCacheValue({
        type,
        search,
        category,
        zipcode,
        page: pageNum,
        limit: limitNum,
    })}`;

    const where: any = { isEnabled: true };
    if (type) {
        // Support comma-separated types: PACKAGE,PROFILE
        const types = (type as string).split(',').map(t => t.trim().toUpperCase());
        where.type = types.length === 1 ? types[0] : { in: types };
    }
    if (search) {
        const searchClause = buildCatalogSearchWhere(search as string);
        where.OR = searchClause.OR;
    }
    if (category) {
        where.categories = {
            some: { category: { slug: category as string, isActive: true } }
        };
    }

    try {
        const payload = await getOrSetJsonCache(cacheKey, search ? 120 : 300, async () => {
            const candidateLimit = search
                ? Math.min(500, Math.max(100, skip + limitNum))
                : limitNum;
            const querySkip = search ? 0 : skip;

            const [items, totalCount] = await Promise.all([
                prisma.catalogItem.findMany({
                    where,
                    include: {
                        categories: {
                            include: {
                                category: { select: { id: true, name: true, slug: true } }
                            }
                        }
                    },
                    orderBy: { name: 'asc' },
                    skip: querySkip,
                    take: candidateLimit,
                }),
                prisma.catalogItem.count({ where }),
            ]);

            const rankedItems = search ? rankSearchResults(items, search as string) : items;
            const pageItems = search ? rankedItems.slice(skip, skip + limitNum) : rankedItems;
            const hydratedItems = await hydrateCatalogDetails(pageItems);

            const formatted = hydratedItems.map(item => ({
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
                categories: item.categories.map(c => c.category),
                detailsSummary: buildDetailsSummary(item),
            }));

            return {
                products: formatted,
                totalCount,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(totalCount / limitNum),
            };
        }, { route: 'catalog_products', hasSearch: Boolean(search) });

        res.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
        res.json(payload);
    } catch (error: any) {
        console.error('[Catalog] Error fetching products:', error.message);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// ============================================
// GET /api/catalog/featured?type=PACKAGE|TEST
// Landing page: returns featured items ordered by featuredOrder
// ============================================
router.get('/featured', async (req: Request, res: Response) => {
    const { type, limit = '6' } = req.query;
    const limitNum = Math.min(20, parseInt(limit as string, 10) || 6);
    const cacheKey = `catalog:featured:v1:${hashCacheValue({ type, limit: limitNum })}`;

    const where: any = { isEnabled: true, isFeatured: true };
    if (type) {
        const types = (type as string).split(',').map(t => t.trim().toUpperCase());
        where.type = types.length === 1 ? types[0] : { in: types };
    }

    try {
        const payload = await getOrSetJsonCache(cacheKey, 300, async () => {
            const items = await prisma.catalogItem.findMany({
                where,
                include: {
                    categories: {
                        include: {
                            category: { select: { id: true, name: true, slug: true } }
                        }
                    }
                },
                orderBy: [
                    { featuredOrder: 'asc' },
                    { name: 'asc' },
                ],
                take: limitNum,
            });

            const hydratedItems = await hydrateCatalogDetails(items);

            const formatted = hydratedItems.map(item => ({
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
                categories: item.categories.map(c => c.category),
                detailsSummary: buildDetailsSummary(item),
            }));

            return { products: formatted };
        }, { route: 'catalog_featured' });

        res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
        res.json(payload);
    } catch (error: any) {
        console.error('[Catalog] Error fetching featured:', error.message);
        res.status(500).json({ error: 'Failed to fetch featured products' });
    }
});

// ============================================
// GET /api/catalog/products/:code
// Single product detail by partnerCode
// ============================================
router.get('/products/:code', async (req: Request, res: Response) => {
    try {
        const code = req.params.code as string;
        const cacheKey = `catalog:product:v1:${hashCacheValue(code)}`;

        const payload = await getOrSetJsonCache(cacheKey, 300, async () => {
            const item = await prisma.catalogItem.findUnique({
                where: { partnerCode: code },
                include: {
                    categories: {
                        include: { category: { select: { id: true, name: true, slug: true } } }
                    }
                }
            });

            if (!item || !item.isEnabled) return null;

            return {
                ...item,
                price: item.discountedPrice ?? item.displayPrice,
                mrp: item.discountedPrice ? item.displayPrice : null,
                categories: item.categories.map((c: any) => c.category),
                detailsSummary: buildDetailsSummary(item),
            };
        }, { route: 'catalog_product_detail' });

        if (!payload) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
        res.json(payload);
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// ============================================
// GET /api/catalog/product-details/:dealType/:dealTypeId
// Fetch rich product details from Healthians API
// ============================================
router.get('/product-details/:dealType/:dealTypeId', async (req: Request, res: Response) => {
    try {
        const dealType = req.params.dealType as string;
        const dealTypeId = req.params.dealTypeId as string;
        
        // Basic validation
        if (!['package', 'profile', 'parameter'].includes(dealType.toLowerCase())) {
            return res.status(400).json({ error: 'Invalid dealType' });
        }
        if (!dealTypeId || isNaN(Number(dealTypeId))) {
            return res.status(400).json({ error: 'Invalid dealTypeId' });
        }

        const cacheKey = `catalog:partner-product-details:v1:${dealType.toLowerCase()}:${dealTypeId}`;
        const details = await getOrSetJsonCache(cacheKey, 30 * 24 * 60 * 60, async () => {
            const adapter = HealthiansAdapter.getInstance();
            return adapter.getProductDetails(dealType.toLowerCase(), dealTypeId);
        }, { route: 'catalog_partner_product_details', dealType: dealType.toLowerCase() });

        // Map Healthians standard error response to standard HTTP status if needed
        if (details && details.status === false) {
             return res.status(404).json({ error: details.message || 'Product details not found' });
        }

        res.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
        res.json(details);
    } catch (error: any) {
        console.error('[Catalog] Error fetching product details:', error.message);
        res.status(500).json({ error: 'Failed to fetch product details' });
    }
});

// ============================================
// GET /api/catalog/categories
// User-facing: active categories with enabled items
// ============================================
router.get('/categories', async (req: Request, res: Response) => {
    try {
        const payload = await getOrSetJsonCache('catalog:categories:v1', 600, async () => {
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

            return { categories: formatted };
        }, { route: 'catalog_categories' });

        res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=120');
        res.json(payload);
    } catch (error: any) {
        console.error('[Catalog] Error fetching categories:', error.message);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

export default router;
