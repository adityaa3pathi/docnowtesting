import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

/**
 * GET /api/bookings - List User Bookings
 */
export async function listBookings(req: AuthRequest, res: Response) {
    try {
        const userId = req.userId!;

        const bookings = await prisma.booking.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                items: true
            }
        });

        // Map to DTO
        const sanitizedBookings = bookings.map(b => ({
            id: b.id,
            partnerBookingId: b.partnerBookingId,
            status: b.status,
            slotDate: b.slotDate,
            slotTime: b.slotTime,
            totalAmount: b.totalAmount,
            createdAt: b.createdAt,
            items: b.items.map(i => i.testName)
        }));

        res.json(sanitizedBookings);
    } catch (error) {
        console.error('List Bookings Error:', error);
        res.status(500).json({ error: 'Failed to list bookings' });
    }
}
