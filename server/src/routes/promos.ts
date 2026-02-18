import { Router, Response } from 'express';
import { prisma } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { calculateDiscount } from '../utils/promoHelper';

const router = Router();

// GET /api/promos/available — list promos the user can use right now
router.get('/available', authMiddleware, async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;

    try {
        const now = new Date();

        // Get promo IDs already redeemed by user
        const userRedemptions = await prisma.promoRedemption.findMany({
            where: { userId },
            select: { promoCodeId: true }
        });
        const redeemedIds = userRedemptions.map(r => r.promoCodeId);

        const promos = await prisma.promoCode.findMany({
            where: {
                isActive: true,
                startsAt: { lte: now },
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: now } }
                ],
                id: { notIn: redeemedIds }
            },
            select: {
                id: true,
                code: true,
                description: true,
                discountType: true,
                discountValue: true,
                maxDiscount: true,
                minOrderValue: true,
                maxRedemptions: true,
                redeemedCount: true,
                expiresAt: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // Filter out globally exhausted promos (Prisma can't compare two columns)
        const available = promos
            .filter(p => p.maxRedemptions === null || p.redeemedCount < p.maxRedemptions)
            .map(({ maxRedemptions, redeemedCount, ...rest }) => rest); // Strip internal counters

        res.json(available);
    } catch (error) {
        console.error('Error fetching available promos:', error);
        res.status(500).json({ error: 'Failed to fetch promos' });
    }
});

// POST /api/promos/validate
router.post('/validate', authMiddleware, async (req: AuthRequest, res: Response) => {
    const { code: rawCode, cartAmount } = req.body;
    const userId = req.userId!;

    if (!rawCode || typeof cartAmount !== 'number') {
        return res.status(400).json({ error: 'Missing code or invalid cartAmount' });
    }

    const code = rawCode.trim().toUpperCase();

    try {
        const promo = await prisma.promoCode.findUnique({
            where: { code }
        });

        if (!promo || !promo.isActive) {
            return res.status(400).json({ valid: false, error: 'Invalid or inactive promo code' });
        }

        // Check expiry
        if (promo.expiresAt && new Date() > promo.expiresAt) {
            return res.status(400).json({ valid: false, error: 'Promo code expired' });
        }

        // Check start date
        if (new Date() < promo.startsAt) {
            return res.status(400).json({ valid: false, error: 'Promo code not yet active' });
        }

        // Check global usage limit
        if (promo.maxRedemptions !== null && promo.redeemedCount >= promo.maxRedemptions) {
            return res.status(400).json({ valid: false, error: 'Promo usage limit reached' });
        }

        // Check minimum order value
        if (cartAmount < promo.minOrderValue) {
            return res.status(400).json({
                valid: false,
                error: `Minimum order value of ₹${promo.minOrderValue} required`
            });
        }

        // Check per-user usage limit
        const userRedemptionCount = await prisma.promoRedemption.count({
            where: { userId, promoCodeId: promo.id }
        });
        if (userRedemptionCount >= promo.maxPerUser) {
            return res.status(400).json({
                valid: false,
                error: promo.maxPerUser === 1
                    ? 'You have already used this promo code'
                    : `You have used this promo code ${userRedemptionCount}/${promo.maxPerUser} times`
            });
        }

        const discount = calculateDiscount(promo, cartAmount);

        res.json({
            valid: true,
            discountAmount: discount,
            finalAmount: Math.max(0, cartAmount - discount),
            promoCodeId: promo.id,
            description: promo.description,
            code: promo.code,
            discountType: promo.discountType,
            discountValue: promo.discountValue
        });

    } catch (error) {
        console.error('Promo validation error:', error);
        res.status(500).json({ error: 'Validation failed' });
    }
});

export default router;
