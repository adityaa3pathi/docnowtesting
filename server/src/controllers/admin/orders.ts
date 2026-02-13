import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

/**
 * GET /api/admin/orders — List all orders (paginated)
 */
export async function listOrders(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = req.query.search as string;
        const status = req.query.status as string;

        const where: any = {};

        if (status && status !== 'All') {
            where.status = status;
        }

        if (search) {
            where.OR = [
                { id: { contains: search, mode: 'insensitive' } },
                { partnerBookingId: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { mobile: { contains: search } } },
                { patient: { name: { contains: search, mode: 'insensitive' } } }
            ];
        }

        const orders = await prisma.booking.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, name: true, mobile: true, email: true } },
                items: {
                    include: {
                        patient: { select: { name: true, gender: true, age: true } }
                    }
                }
            }
        });

        const total = await prisma.booking.count({ where });

        res.json({
            orders: orders.map(order => ({
                id: order.id,
                partnerBookingId: order.partnerBookingId,
                date: order.createdAt,
                slotDate: order.slotDate,
                slotTime: order.slotTime,
                amount: order.totalAmount,
                status: order.status,
                user: order.user,
                patient: order.items[0]?.patient || null,
                testNames: order.items.map(i => i.testName)
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Admin] Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
}
