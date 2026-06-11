import { describe, expect, it } from 'vitest';
import { PromoCode } from '@prisma/client';
import { calculateDiscount } from './promoHelper';

function promo(overrides: Partial<PromoCode>): PromoCode {
    return {
        id: 'promo-1',
        code: 'SAVE',
        description: null,
        discountType: 'FLAT',
        discountValue: 0,
        maxDiscount: null,
        minOrderValue: 0,
        maxRedemptions: null,
        maxPerUser: 1,
        redeemedCount: 0,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: null,
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
    };
}

describe('calculateDiscount', () => {
    it('returns zero when the cart total is below the minimum order value', () => {
        const discount = calculateDiscount(promo({ discountValue: 100, minOrderValue: 500 }), 499);

        expect(discount).toBe(0);
    });

    it('caps percentage discounts at maxDiscount', () => {
        const discount = calculateDiscount(
            promo({ discountType: 'PERCENTAGE', discountValue: 20, maxDiscount: 150 }),
            1000
        );

        expect(discount).toBe(150);
    });

    it('never discounts more than the cart total', () => {
        const discount = calculateDiscount(promo({ discountType: 'FLAT', discountValue: 1000 }), 399);

        expect(discount).toBe(399);
    });
});
