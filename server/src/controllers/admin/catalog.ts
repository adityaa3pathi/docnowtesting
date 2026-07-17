import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { HealthiansAdapter } from '../../adapters/healthians';
import { buildCatalogSearchWhere, normalizeSearchTerm } from '../../utils/searchUtils';

const healthians = HealthiansAdapter.getInstance();

// Simple in-memory lock so only one sync runs at a time
let syncInProgress = false;

function normalizeType(dealType?: string): 'TEST' | 'PACKAGE' | 'PROFILE' {
    if (!dealType) return 'TEST';
    const t = dealType.toLowerCase();
    if (t === 'package' || t === 'combo') return 'PACKAGE';
    if (t === 'profile') return 'PROFILE';
    return 'TEST';
}

export async function syncCatalog(req: AuthRequest, res: Response) {
    const { zipcode } = req.body;

    if (!zipcode) {
        return res.status(400).json({ error: 'zipcode is required for sync' });
    }

    if (syncInProgress) {
        return res.status(409).json({ error: 'A sync is already in progress. Please wait.' });
    }

    res.status(202).json({ message: 'Sync started in background. Check catalog in ~60 seconds.' });

    syncInProgress = true;
    (async () => {
        try {
            console.log(`[Admin] Background catalog sync started for zipcode=${zipcode}`);
            const response = await healthians.getPartnerProducts(zipcode);
            const products: any[] = response?.data || [];

            if (!Array.isArray(products) || products.length === 0) {
                console.warn('[Admin] No products returned from Healthians.');
                return;
            }

            console.log(`[Admin] Processing ${products.length} products...`);

            const normalized = products.map((product: any) => {
                const partnerCode = String(product.deal_id || `${product.product_type}_${product.product_type_id}` || product.id);
                const name = product.test_name || product.name || product.deal_name || 'Unknown';
                const price = parseFloat(product.price || product.mrp || '0');
                const type = normalizeType(product.product_type || product.deal_type);
                return { partnerCode, name, price, type, raw: product };
            });

            const existingCodes = new Set(
                (await prisma.catalogItem.findMany({ select: { partnerCode: true } }))
                    .map(r => r.partnerCode)
            );

            const toCreate = normalized.filter(p => !existingCodes.has(p.partnerCode));
            const toUpdate = normalized.filter(p => existingCodes.has(p.partnerCode));

            if (toCreate.length > 0) {
                await prisma.catalogItem.createMany({
                    data: toCreate.map(p => ({
                        partnerCode: p.partnerCode,
                        name: p.name,
                        searchName: normalizeSearchTerm(p.name),
                        type: p.type,
                        partnerPrice: p.price,
                        displayPrice: p.price,
                        description: p.raw.description || null,
                        parameters: p.raw.parameters || p.raw.parameter_count?.toString() || null,
                        sampleType: p.raw.sample_type || null,
                        reportTime: p.raw.report_time || p.raw.report_tat || null,
                        partnerData: p.raw,
                        isEnabled: true,
                    })),
                    skipDuplicates: true,
                });
            }

            const BATCH = 50;
            for (let i = 0; i < toUpdate.length; i += BATCH) {
                const batch = toUpdate.slice(i, i + BATCH);
                await Promise.all(batch.map(p =>
                    prisma.catalogItem.update({
                        where: { partnerCode: p.partnerCode },
                        data: {
                            partnerPrice: p.price,
                            name: p.name,
                            searchName: normalizeSearchTerm(p.name),
                            type: p.type,
                            description: p.raw.description || undefined,
                            parameters: p.raw.parameters || p.raw.parameter_count?.toString() || undefined,
                            sampleType: p.raw.sample_type || undefined,
                            reportTime: p.raw.report_time || p.raw.report_tat || undefined,
                            partnerData: p.raw,
                        },
                    })
                ));
            }

            console.log(`[Admin] Catalog sync complete: ${toCreate.length} created, ${toUpdate.length} updated (total ${products.length})`);
        } catch (err: any) {
            console.error('[Admin] Background catalog sync error:', err.message);
        } finally {
            syncInProgress = false;
        }
    })();
}

export async function listCatalog(req: AuthRequest, res: Response) {
    const { type, enabled, search, page = '1', limit = '50' } = req.query;

    const where: any = {};
    if (type) where.type = type;
    if (enabled !== undefined) where.isEnabled = enabled === 'true';
    if (search) {
        const searchClause = buildCatalogSearchWhere(search as string);
        where.OR = searchClause.OR;
    }

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
}

export async function updateCatalogItem(req: AuthRequest, res: Response) {
    const id = req.params.id as string;
    const { displayPrice, discountedPrice, isEnabled, name, description, parameters, sampleType, reportTime, type } = req.body;

    try {
        const existing = await prisma.catalogItem.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Catalog item not found' });

        const data: any = {};
        if (displayPrice !== undefined) data.displayPrice = parseFloat(displayPrice);
        if (discountedPrice !== undefined) data.discountedPrice = discountedPrice === null ? null : parseFloat(discountedPrice);
        if (isEnabled !== undefined) data.isEnabled = Boolean(isEnabled);
        if (name !== undefined) {
            data.name = name;
            data.searchName = normalizeSearchTerm(name);
        }
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
}

export async function toggleCatalogItem(req: AuthRequest, res: Response) {
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
}

export async function featureCatalogItem(req: AuthRequest, res: Response) {
    const id = req.params.id as string;
    const { isFeatured, featuredOrder } = req.body;

    try {
        const existing = await prisma.catalogItem.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Catalog item not found' });

        const updated = await prisma.catalogItem.update({
            where: { id },
            data: {
                isFeatured: typeof isFeatured === 'boolean' ? isFeatured : !existing.isFeatured,
                featuredOrder: isFeatured === false ? null : (featuredOrder ?? existing.featuredOrder),
            }
        });

        res.json({ id: updated.id, name: updated.name, isFeatured: updated.isFeatured, featuredOrder: updated.featuredOrder });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update featured status', details: error.message });
    }
}
