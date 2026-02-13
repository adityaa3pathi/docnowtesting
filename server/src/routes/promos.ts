import { Router, Response } from 'express';
import { prisma } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { calculateDiscount } from '../utils/promoHelper';

const router = Router();

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

        // Check per-user usage (prevent abuse)
        const existingRedemption = await prisma.promoRedemption.findFirst({
            where: { userId, promoCodeId: promo.id }
        });
        if (existingRedemption) {
            return res.status(400).json({ valid: false, error: 'You have already used this promo code' });
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
