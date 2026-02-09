"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listBookings = listBookings;
const db_1 = require("../../db");
/**
 * GET /api/bookings - List User Bookings
 */
async function listBookings(req, res) {
    try {
        const userId = req.userId;
        const bookings = await db_1.prisma.booking.findMany({
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
    }
    catch (error) {
        console.error('List Bookings Error:', error);
        res.status(500).json({ error: 'Failed to list bookings' });
    }
}
