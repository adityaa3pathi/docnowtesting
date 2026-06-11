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
            return res.status(400).json({ error: 'We could not process this request. Please refresh the page and try again.' });
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
            return res.status(404).json({ error: 'We could not find the details for this appointment. Please contact support if the issue persists.' });
        }

        const activePartnerBookingId = booking.rescheduledToId || booking.partnerBookingId;

        if (!activePartnerBookingId) {
            return res.status(400).json({ error: 'Your appointment details are still being processed by our lab partner. Please try again shortly.' });
        }

        // 4. Call Healthians getPhleboMaskNumber directly.
        //    The Healthians API itself enforces availability rules:
        //    ✅ Phlebo must be assigned  ✅ Sample must NOT be collected yet
        //    We don't pre-flight check BS codes — that's fragile and breaks
        //    on unmapped intermediate statuses (e.g. BS006 = Phlebo Reached Home).

        // 5. Call Healthians API
        const phleboResponse = await healthians.getPhleboMaskNumber(activePartnerBookingId);

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
