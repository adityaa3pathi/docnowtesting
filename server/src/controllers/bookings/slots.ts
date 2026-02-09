import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { HealthiansAdapter } from '../../adapters/healthians';
import { BookingService } from '../../services/booking.service';

const healthians = HealthiansAdapter.getInstance();

/**
 * GET /api/bookings/:id/reschedulable-slots - Fetch slots for rescheduling
 */
export async function getReschedulableSlots(req: AuthRequest, res: Response) {
    try {
        const userId = req.userId!;
        const bookingId = req.params.id as string;
        const date = req.query.date as string || new Date().toISOString().split('T')[0];

        console.log(`[Slots] Request for booking: ${bookingId}, date: ${date}`);

        // 1. Fetch Booking with Items
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, userId: userId },
            include: { items: true }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // 2. Determine address (support legacy bookings via query param)
        const addressIdParam = req.query.addressId as string | undefined;
        let address = null;

        if (addressIdParam) {
            address = await prisma.address.findFirst({
                where: { id: addressIdParam, userId }
            });
        }

        if (!address) {
            const userAddresses = await BookingService.getUserAddresses(userId);
            return res.status(400).json({
                error: 'No address associated with this booking',
                code: 'ADDRESS_REQUIRED',
                addresses: userAddresses
            });
        }

        console.log(`[Slots] Address found: ${address.pincode}`);

        // 3. Get Zone ID
        const zoneId = await BookingService.getZoneId(
            address.lat || '28.6139',
            address.long || '77.2090',
            address.pincode
        );

        if (!zoneId) {
            return res.status(400).json({ error: 'Could not determine zone_id for rescheduling' });
        }

        console.log(`[Slots] Zone ID: ${zoneId}`);

        // 4. Prepare Packages
        const patientGroups = new Map<string, string[]>();
        booking.items.forEach((item: any) => {
            if (!patientGroups.has(item.patientId)) {
                patientGroups.set(item.patientId, []);
            }
            patientGroups.get(item.patientId)!.push(item.testCode);
        });

        const packagesPayload = Array.from(patientGroups.values()).map(testCodes => ({
            deal_id: testCodes
        }));

        // 5. Fetch Slots
        const slotsPayload = {
            lat: address.lat || '28.6139',
            long: address.long || '77.2090',
            zipcode: address.pincode,
            zone_id: zoneId.toString(),
            slot_date: date,
            amount: booking.totalAmount,
            package: packagesPayload
        };

        console.log('[Slots] Request payload:', JSON.stringify(slotsPayload, null, 2));

        const slotsResponse = await healthians.getSlotsByLocation(slotsPayload);
        console.log('[Slots] Response received');

        return res.json(slotsResponse);
    } catch (error) {
        console.error('Fetch Reschedulable Slots Error:', error);
        res.status(500).json({ error: 'Failed to fetch available slots for rescheduling' });
    }
}
