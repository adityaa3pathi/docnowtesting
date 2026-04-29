import { Response } from 'express';
import { prisma } from '../../db';
import { AuthRequest } from '../../middleware/auth';

export const listAbandonedCarts = async (req: AuthRequest, res: Response) => {
    try {
        const thresholdMins = parseInt(req.query.threshold as string) || 30;
        const thresholdDate = new Date(Date.now() - thresholdMins * 60 * 1000);

        // Find carts that:
        // 1. Have at least one item
        // 2. Were last active before the threshold
        // 3. User has not placed a successful booking AFTER the lastActivityAt timestamp
        
        const abandonedCarts = await prisma.cart.findMany({
            where: {
                items: {
                    some: {} // Has at least one item
                },
                lastActivityAt: {
                    lt: thresholdDate
                }
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        mobile: true,
                        email: true
                    }
                },
                items: true
            },
            orderBy: {
                lastActivityAt: 'desc'
            }
        });

        // Filter out users who completed a booking after their last cart activity
        // This handles the "converted" case.
        const filteredCarts = await Promise.all(abandonedCarts.map(async (cart) => {
            const recentBooking = await prisma.booking.findFirst({
                where: {
                    userId: cart.userId,
                    createdAt: {
                        gt: cart.lastActivityAt
                    },
                    paymentStatus: {
                        in: ['CONFIRMED', 'AUTHORIZED', 'PAID']
                    }
                }
            });

            if (recentBooking) return null;
            
            return {
                id: cart.id,
                userId: cart.user.id,
                userName: cart.user.name,
                userMobile: cart.user.mobile,
                userEmail: cart.user.email,
                lastActivityAt: cart.lastActivityAt,
                itemCount: cart.items.length,
                totalValue: cart.items.reduce((sum, item) => sum + item.price, 0),
                items: cart.items.map(item => ({
                    testCode: item.testCode,
                    testName: item.testName,
                    price: item.price
                }))
            };
        }));

        const result = filteredCarts.filter(c => c !== null);

        res.json(result);
    } catch (error) {
        console.error('[Admin] List Abandoned Carts Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
