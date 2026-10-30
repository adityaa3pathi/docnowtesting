/** Adding catalog items to a user's cart, shared by the cart API and consultation prescriptions. */
import { prisma } from '../db';

export type AddToCartResult =
    | { ok: true; item: Awaited<ReturnType<typeof createItem>> }
    | { ok: false; status: number; error: string; code?: string };

function createItem(cartId: string, testCode: string, testName: string, price: number, mrp: number | null, patientId: string | null) {
    return prisma.$transaction([
        prisma.cartItem.create({
            data: { cartId, testCode, testName, price, mrp, patientId },
            include: { patient: { select: { id: true, name: true, relation: true } } },
        }),
        prisma.cart.update({ where: { id: cartId }, data: { lastActivityAt: new Date() } }),
    ]).then(([item]) => item);
}

/** Prices come from the catalog, never the caller. Duplicates are allowed, for multi-patient bookings. */
export async function addCatalogItemToCart(userId: string, testCode: string, patientId: string | null): Promise<AddToCartResult> {
    const catalogItem = await prisma.catalogItem.findUnique({ where: { partnerCode: testCode } });
    if (!catalogItem) return { ok: false, status: 404, error: 'Product not found in catalog' };
    if (!catalogItem.isEnabled) return { ok: false, status: 400, error: 'This product is currently unavailable', code: 'ITEM_DISABLED' };

    const price = catalogItem.discountedPrice ?? catalogItem.displayPrice;
    const mrp = catalogItem.discountedPrice ? catalogItem.displayPrice : null;
    const cart = await prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    return { ok: true, item: await createItem(cart.id, testCode, catalogItem.name, price, mrp, patientId) };
}
