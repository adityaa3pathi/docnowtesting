import express, { Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';
const router = express.Router();

// GET /api/cart - Get user's cart with all items + availability status
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        let cart = await prisma.cart.findUnique({
            where: { userId: req.userId },
            include: {
                items: {
                    include: {
                        patient: {
                            select: { id: true, name: true, relation: true }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!cart) {
            cart = await prisma.cart.create({
                data: { userId: req.userId! },
                include: {
                    items: {
                        include: {
                            patient: {
                                select: { id: true, name: true, relation: true }
                            }
                        }
                    }
                }
            });
        }

        // Annotate each item with current catalog availability
        const testCodes = cart.items.map(i => i.testCode);
        const catalogItems = await prisma.catalogItem.findMany({
            where: { partnerCode: { in: testCodes } },
            select: { partnerCode: true, isEnabled: true, displayPrice: true, discountedPrice: true, name: true }
        });
        const catalogMap = new Map(catalogItems.map(c => [c.partnerCode, c]));

        const annotatedItems = cart.items.map(item => {
            const catalogEntry = catalogMap.get(item.testCode);
            return {
                ...item,
                isAvailable: catalogEntry?.isEnabled ?? false,
                currentPrice: catalogEntry ? (catalogEntry.discountedPrice ?? catalogEntry.displayPrice) : item.price
            };
        });

        res.status(200).json({ ...cart, items: annotatedItems });
    } catch (error) {
        console.error('Get Cart Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/cart/items - Add item to cart
// Security: validates against internal catalog, enforces server-side price
router.post('/items', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { testCode, patientId } = req.body;

        if (!testCode) {
            res.status(400).json({ error: 'testCode is required' });
            return;
        }

        // 1. Validate against internal catalog
        const catalogItem = await prisma.catalogItem.findUnique({
            where: { partnerCode: testCode }
        });

        if (!catalogItem) {
            res.status(404).json({ error: 'Product not found in catalog' });
            return;
        }

        if (!catalogItem.isEnabled) {
            res.status(400).json({ error: 'This product is currently unavailable', code: 'ITEM_DISABLED' });
            return;
        }

        // 2. Use server-side price (ignore client-sent price)
        const serverPrice = catalogItem.discountedPrice ?? catalogItem.displayPrice;
        const serverMrp = catalogItem.discountedPrice ? catalogItem.displayPrice : null;

        // 3. Get or create cart
        let cart = await prisma.cart.findUnique({ where: { userId: req.userId } });
        if (!cart) {
            cart = await prisma.cart.create({ data: { userId: req.userId! } });
        }

        // 4. Check duplicate
        const existingItem = await prisma.cartItem.findFirst({
            where: { cartId: cart.id, testCode }
        });

        if (existingItem) {
            res.status(409).json({ error: 'Item already in cart' });
            return;
        }

        // 5. Create cart item with server-side data
        const cartItem = await prisma.cartItem.create({
            data: {
                cartId: cart.id,
                testCode,
                testName: catalogItem.name,
                price: serverPrice,
                mrp: serverMrp,
                patientId: patientId || null
            },
            include: {
                patient: { select: { id: true, name: true, relation: true } }
            }
        });

        res.status(201).json({
            message: 'Item added to cart',
            item: cartItem
        });
    } catch (error) {
        console.error('Add to Cart Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PUT /api/cart/items/:id - Update cart item (assign patient)
router.put('/items/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;
        const { patientId } = req.body;

        // Verify ownership
        const cartItem = await prisma.cartItem.findUnique({
            where: { id },
            include: { cart: true }
        });

        if (!cartItem) {
            res.status(404).json({ error: 'Cart item not found' });
            return;
        }

        if (cartItem.cart.userId !== req.userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        // Update cart item
        const updatedItem = await prisma.cartItem.update({
            where: { id },
            data: { patientId: patientId || null },
            include: {
                patient: {
                    select: {
                        id: true,
                        name: true,
                        relation: true
                    }
                }
            }
        });

        res.status(200).json({
            message: 'Cart item updated',
            item: updatedItem
        });
    } catch (error) {
        console.error('Update Cart Item Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// DELETE /api/cart/items/:id - Remove item from cart
router.delete('/items/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;
        console.log(`[CART] Attempting to remove item: ${id} for user: ${req.userId}`);

        // Verify ownership
        const cartItem = await prisma.cartItem.findUnique({
            where: { id },
            include: { cart: true }
        });

        if (!cartItem) {
            console.warn(`[CART] Item ${id} not found`);
            res.status(404).json({ error: 'Cart item not found' });
            return;
        }

        if (cartItem.cart.userId !== req.userId) {
            console.warn(`[CART] Unauthorized removal attempt. Item owner: ${cartItem.cart.userId}, Request user: ${req.userId}`);
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        await prisma.cartItem.delete({
            where: { id }
        });
        console.log(`[CART] Successfully removed item ${id}`);

        res.status(200).json({ message: 'Item removed from cart' });
    } catch (error) {
        console.error('Delete Cart Item Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// DELETE /api/cart - Clear entire cart
router.delete('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await prisma.cartItem.deleteMany({
            where: {
                cart: {
                    userId: req.userId
                }
            }
        });

        res.status(200).json({ message: 'Cart cleared' });
    } catch (error) {
        console.error('Clear Cart Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
