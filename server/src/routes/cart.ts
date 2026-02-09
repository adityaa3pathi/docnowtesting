import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/cart - Get user's cart with all items
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        let cart = await prisma.cart.findUnique({
            where: { userId: req.userId },
            include: {
                items: {
                    include: {
                        patient: {
                            select: {
                                id: true,
                                name: true,
                                relation: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        // Create cart if doesn't exist
        if (!cart) {
            cart = await prisma.cart.create({
                data: { userId: req.userId! },
                include: {
                    items: {
                        include: {
                            patient: {
                                select: {
                                    id: true,
                                    name: true,
                                    relation: true
                                }
                            }
                        }
                    }
                }
            });
        }

        res.status(200).json(cart);
    } catch (error) {
        console.error('Get Cart Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/cart/items - Add item to cart
router.post('/items', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { testCode, testName, price, mrp, patientId } = req.body;

        // Validate required fields
        if (!testCode || !testName || price === undefined) {
            res.status(400).json({ error: 'testCode, testName, and price are required' });
            return;
        }

        // Get or create cart
        let cart = await prisma.cart.findUnique({
            where: { userId: req.userId }
        });

        if (!cart) {
            cart = await prisma.cart.create({
                data: { userId: req.userId! }
            });
        }

        // Check if item already exists in cart
        const existingItem = await prisma.cartItem.findFirst({
            where: {
                cartId: cart.id,
                testCode: testCode
            }
        });

        if (existingItem) {
            res.status(409).json({ error: 'Item already in cart' });
            return;
        }

        // Add item to cart
        const cartItem = await prisma.cartItem.create({
            data: {
                cartId: cart.id,
                testCode,
                testName,
                price: parseFloat(price.toString()),
                mrp: mrp ? parseFloat(mrp.toString()) : null,
                patientId: patientId || null
            },
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
