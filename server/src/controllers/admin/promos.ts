import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

/**
 * GET /api/admin/promos — List all promo codes (paginated)
 */
export async function listPromos(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;

        const promos = await prisma.promoCode.findMany({
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' }
        });

        const total = await prisma.promoCode.count();

        res.json({
            promos,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Admin] Error fetching promos:', error);
        res.status(500).json({ error: 'Failed to fetch promos' });
    }
}

/**
 * POST /api/admin/promos — Create new promo code
 */
export async function createPromo(req: AuthRequest, res: Response) {
    try {
        const {
            code, description, discountType, discountValue,
            maxDiscount, minOrderValue, maxRedemptions,
            startsAt, expiresAt
        } = req.body;

        // Basic Validation
        if (!code || !discountType || !discountValue) {
            return res.status(400).json({ error: 'Missing required fields: code, discountType, discountValue' });
        }

        if (!['PERCENTAGE', 'FLAT'].includes(discountType)) {
            return res.status(400).json({ error: 'discountType must be PERCENTAGE or FLAT' });
        }

        const promo = await prisma.promoCode.create({
            data: {
                code: code.trim().toUpperCase(),
                description: description || null,
                discountType,
                discountValue: parseFloat(discountValue),
                maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
                minOrderValue: minOrderValue ? parseFloat(minOrderValue) : 0,
                maxRedemptions: maxRedemptions ? parseInt(maxRedemptions) : null,
                startsAt: startsAt ? new Date(startsAt) : new Date(),
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                isActive: true
            }
        });

        // Audit Log
        await prisma.adminAuditLog.create({
            data: {
                adminId: req.userId!,
                adminName: req.adminName!,
                action: 'CREATE',
                entity: 'PromoCode',
                targetId: promo.id,
                newValue: { code: promo.code, discountType: promo.discountType, discountValue: promo.discountValue }
            }
        });

        res.status(201).json(promo);
    } catch (error) {
        console.error('[Admin] Error creating promo:', error);
        res.status(500).json({ error: 'Failed to create promo' });
    }
}

/**
 * PUT /api/admin/promos/:id — Update promo (Toggle Status / Expiry)
 */
export async function updatePromo(req: AuthRequest, res: Response) {
    try {
        const id = req.params.id as string;
        const { isActive, expiresAt } = req.body;

        const promo = await prisma.promoCode.update({
            where: { id },
            data: {
                isActive: isActive !== undefined ? isActive : undefined,
                expiresAt: expiresAt ? new Date(expiresAt) : undefined
            }
        });

        // Audit Log
        await prisma.adminAuditLog.create({
            data: {
                adminId: req.userId!,
                adminName: req.adminName!,
                action: 'UPDATE',
                entity: 'PromoCode',
                targetId: promo.id,
                newValue: { isActive: promo.isActive, expiresAt: promo.expiresAt }
            }
        });

        res.json(promo);
    } catch (error) {
        console.error('[Admin] Error updating promo:', error);
        res.status(500).json({ error: 'Failed to update promo' });
    }
}
