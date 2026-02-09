import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { HealthiansAdapter } from '../../adapters/healthians';
import { validationSchemas } from '../../utils/helpers';
import { BookingService } from '../../services/booking.service';

const healthians = HealthiansAdapter.getInstance();

// In-memory cache for phlebo contact (masked numbers)
const phleboCache: Record<string, { data: any, expiry: number }> = {};

/**
 * GET /api/bookings/:id/phlebo-contact - Get assigned phlebotomist contact
 */
export async function getPhleboContact(req: AuthRequest, res: Response) {
    try {
        const userId = req.userId!;
        const bookingId = req.params.id as string;

        // 1. Validation
        const parse = validationSchemas.uuid.safeParse(bookingId);
        if (!parse.success) {
            return res.status(400).json({ error: 'Invalid Booking ID format' });
        }

        // 2. Check Cache
        const now = Date.now();
        if (phleboCache[bookingId] && phleboCache[bookingId].expiry > now) {
            console.log('Returning cached phlebo contact for:', bookingId);
            return res.json(phleboCache[bookingId].data);
        }

        // 3. Ownership Check
        const booking = await BookingService.getBookingWithAuth(bookingId, userId);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        if (!booking.partnerBookingId) {
            return res.status(400).json({ error: 'Partner Booking ID missing for this order' });
        }

        // 4. Verify Status (BS005 = Sample Collector Assigned)
        const { bookingStatus } = await BookingService.getHealthiansCustomers(booking.partnerBookingId);

        if (bookingStatus !== 'BS005') {
            return res.status(400).json({
                error: 'Phlebotomist contact is only available once assigned and before collection.',
                currentStatus: bookingStatus
            });
        }

        // 5. Call Healthians API
        const phleboResponse = await healthians.getPhleboMaskNumber(booking.partnerBookingId);

        if (phleboResponse.status && phleboResponse.data) {
            const result = {
                masked_number: phleboResponse.data.masked_number,
                phlebo_name: phleboResponse.data.phlebo_name
            };

            // Cache for 5 minutes
            phleboCache[bookingId] = {
                data: result,
                expiry: now + (5 * 60 * 1000)
            };

            return res.json(result);
        } else {
            return res.status(400).json({
                error: phleboResponse.message || 'Phlebotomist details not available yet.'
            });
        }

    } catch (error) {
        console.error('Phlebo Contact Error:', error);
        res.status(500).json({ error: 'Failed to fetch phlebotomist contact' });
    }
}
