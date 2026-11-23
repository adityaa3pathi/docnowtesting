import { Prisma, PromoCode } from '@prisma/client';

/** Row lock on a promo code for the rest of the transaction; consultation bookings take the same one. */
export async function lockPromo(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, promoCodeId: string) {
    await tx.$queryRaw`SELECT id FROM "PromoCode" WHERE id = ${promoCodeId} FOR UPDATE`;
}

/** Lab and camp checkout refuse codes made only for doctor consultations. */
export const CONSULT_ONLY_PROMO = 'This promo code is for doctor consultations only';

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
