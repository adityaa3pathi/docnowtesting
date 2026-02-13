import { PromoCode } from '@prisma/client';

export const calculateDiscount = (promo: PromoCode, cartTotal: number): number => {
    let discount = 0;

    if (cartTotal < promo.minOrderValue) {
        return 0;
    }

    if (promo.discountType === 'PERCENTAGE') {
        discount = (cartTotal * promo.discountValue) / 100;
        if (promo.maxDiscount && discount > promo.maxDiscount) {
            discount = promo.maxDiscount;
        }
    } else { // FLAT
        discount = promo.discountValue;
    }

    // Ensure discount doesn't exceed total
    return Math.min(discount, cartTotal);
};
