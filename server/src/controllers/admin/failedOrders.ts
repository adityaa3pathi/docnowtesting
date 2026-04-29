import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

/**
 * GET /api/admin/failed-orders — List all failed orders (paginated)
 */
export async function listFailedOrders(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = req.query.search as string;
        const dateFrom = req.query.dateFrom as string;
        const dateTo = req.query.dateTo as string;

        const where: any = {
            OR: [
                { paymentStatus: { in: ['FAILED', 'PARTNER_FAILED', 'REFUNDED'] } },
                { status: { in: ['CANCELLED', 'BOOKING_FAILED'] } }
            ]
        };

        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) {
                where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
            }
            if (dateTo) {
                const end = new Date(`${dateTo}T00:00:00.000Z`);
                end.setUTCDate(end.getUTCDate() + 1);
                where.createdAt.lt = end;
            }
        }

        if (search) {
            where.AND = [
                {
                    OR: [
                        { id: { contains: search, mode: 'insensitive' } },
                        { partnerBookingId: { contains: search, mode: 'insensitive' } },
                        { user: { name: { contains: search, mode: 'insensitive' } } },
                        { user: { mobile: { contains: search } } },
                        { items: { some: { patient: { name: { contains: search, mode: 'insensitive' } } } } },
                    ]
                }
            ];
        }

        const orders = await prisma.booking.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, name: true, mobile: true, email: true } },
                address: { select: { id: true, line1: true, city: true, pincode: true } },
                items: {
                    include: {
                        patient: { select: { name: true, relation: true, gender: true, age: true } }
                    }
                },
                partnerRetry: true
            }
        });

        const total = await prisma.booking.count({ where });

        res.json({
            orders: orders.map(order => ({
                id: order.id,
                partnerBookingId: order.partnerBookingId,
                date: order.createdAt,
                amount: order.totalAmount,
                status: order.status,
                paymentStatus: order.paymentStatus,
                user: order.user,
                address: order.address,
                patient: order.items[0]?.patient || null,
                testNames: order.items.map(i => i.testName),
                partnerError: order.partnerError,
                retryLastError: order.partnerRetry?.lastError || null,
                retryAttempts: order.partnerRetry?.attempts || 0,
                nextRetryAt: order.partnerRetry?.nextRetryAt || null,
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Admin] Error fetching failed orders:', error);
        res.status(500).json({ error: 'Failed to fetch failed orders' });
    }
}
