/**
 * Sample collection fee configuration.
 * Must mirror server/src/utils/collectionFee.ts
 */
export const SAMPLE_COLLECTION_FEE = 129;
export const SAMPLE_COLLECTION_FEE_THRESHOLD = 500;

export function getCollectionFee(cartSubtotal: number): number {
    return cartSubtotal < SAMPLE_COLLECTION_FEE_THRESHOLD ? SAMPLE_COLLECTION_FEE : 0;
}
