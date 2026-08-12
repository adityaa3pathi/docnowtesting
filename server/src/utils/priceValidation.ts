import { prisma } from '../db';

export const MANAGER_PRICE_FLOOR_PERCENTAGE = 0.70; // 70%

export interface PriceOverrideItem {
    testCode: string;
    customPrice?: number; // Manager-specified price (optional — omit to use catalog price)
}

export interface ValidatedPriceItem {
    testCode: string;
    testName: string;
    catalogPrice: number;     // discountedPrice ?? displayPrice
    finalPrice: number;       // customPrice if valid, else catalogPrice
    isCustomPrice: boolean;
    floorPrice: number;       // 70% of catalogPrice
}

export interface PriceValidationResult {
    valid: boolean;
    items: ValidatedPriceItem[];
    errors: string[];
    totalAmount: number;
}

/**
 * Validates manager-provided custom prices against catalog floor (70% of discounted price).
 * Returns validated items with final prices, or errors if any price is below floor.
 */
export async function validateManagerPrices(
    items: PriceOverrideItem[]
): Promise<PriceValidationResult> {
    const testCodes = items.map(i => i.testCode);
    const catalogItems = await prisma.catalogItem.findMany({
        where: { partnerCode: { in: testCodes } }
    });
    const catalogMap = new Map(catalogItems.map(c => [c.partnerCode, c]));

    const validated: ValidatedPriceItem[] = [];
    const errors: string[] = [];
    let totalAmount = 0;

    for (const item of items) {
        const cat = catalogMap.get(item.testCode);
        if (!cat) {
            errors.push(`Test code not found: ${item.testCode}`);
            continue;
        }

        const catalogPrice = Math.max(0, cat.discountedPrice ?? cat.displayPrice);
        const floorPrice = Math.round(catalogPrice * MANAGER_PRICE_FLOOR_PERCENTAGE * 100) / 100;

        let finalPrice = catalogPrice;
        let isCustomPrice = false;

        if (item.customPrice !== undefined && item.customPrice !== null) {
            if (typeof item.customPrice !== 'number' || isNaN(item.customPrice)) {
                errors.push(`Invalid custom price for "${cat.name}": must be a number.`);
                continue;
            }
            if (item.customPrice < floorPrice) {
                errors.push(
                    `Price for "${cat.name}" (₹${item.customPrice}) is below the minimum allowed (₹${floorPrice}). ` +
                    `Must be at least 70% of ₹${catalogPrice}.`
                );
                continue;
            }
            if (item.customPrice > catalogPrice) {
                errors.push(
                    `Price for "${cat.name}" (₹${item.customPrice}) exceeds catalog price (₹${catalogPrice}).`
                );
                continue;
            }
            finalPrice = item.customPrice;
            isCustomPrice = true;
        }

        totalAmount += finalPrice;
        validated.push({
            testCode: item.testCode,
            testName: cat.name,
            catalogPrice,
            finalPrice,
            isCustomPrice,
            floorPrice,
        });
    }

    return {
        valid: errors.length === 0 && validated.length === items.length,
        items: validated,
        errors,
        totalAmount,
    };
}

/**
 * Validates a custom price for a camp order against the camp's base price.
 * Returns the validated price or an error message.
 */
export function validateCampCustomPrice(
    customPrice: number,
    basePrice: number,
    campName: string
): { valid: boolean; error?: string; floorPrice: number } {
    const floorPrice = Math.round(basePrice * MANAGER_PRICE_FLOOR_PERCENTAGE * 100) / 100;

    if (typeof customPrice !== 'number' || isNaN(customPrice)) {
        return { valid: false, error: `Invalid custom price for camp "${campName}": must be a number.`, floorPrice };
    }
    if (customPrice < floorPrice) {
        return {
            valid: false,
            error: `Custom price ₹${customPrice} is below the minimum ₹${floorPrice} (70% of ₹${basePrice}).`,
            floorPrice,
        };
    }
    if (customPrice > basePrice) {
        return {
            valid: false,
            error: `Custom price ₹${customPrice} exceeds camp price ₹${basePrice}.`,
            floorPrice,
        };
    }
    return { valid: true, floorPrice };
}
