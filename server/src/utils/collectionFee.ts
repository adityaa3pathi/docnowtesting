/**
 * Sample collection fee configuration.
 * A flat fee is charged when the cart subtotal (before discounts) is below the threshold.
 */
export const SAMPLE_COLLECTION_FEE = 129;
export const SAMPLE_COLLECTION_FEE_THRESHOLD = 500;

/**
 * Returns the applicable collection fee for a given cart subtotal.
 */
export function getCollectionFee(cartSubtotal: number): number {
    return cartSubtotal < SAMPLE_COLLECTION_FEE_THRESHOLD ? SAMPLE_COLLECTION_FEE : 0;
}
