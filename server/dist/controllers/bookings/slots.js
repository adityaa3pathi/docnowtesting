"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReschedulableSlots = getReschedulableSlots;
const db_1 = require("../../db");
const healthians_1 = require("../../adapters/healthians");
const booking_service_1 = require("../../services/booking.service");
const healthians = healthians_1.HealthiansAdapter.getInstance();
/**
 * GET /api/bookings/:id/reschedulable-slots - Fetch slots for rescheduling
 */
async function getReschedulableSlots(req, res) {
    try {
        const userId = req.userId;
        const bookingId = req.params.id;
        const date = req.query.date || new Date().toISOString().split('T')[0];
        console.log(`[Slots] Request for booking: ${bookingId}, date: ${date}`);
        // 1. Fetch Booking with Items
        const booking = await db_1.prisma.booking.findFirst({
            where: { id: bookingId, userId: userId },
            include: { items: true }
        });
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        // 2. Determine address (support legacy bookings via query param)
        const addressIdParam = req.query.addressId;
        let address = null;
        if (addressIdParam) {
            address = await db_1.prisma.address.findFirst({
                where: { id: addressIdParam, userId }
            });
        }
        if (!address) {
            const userAddresses = await booking_service_1.BookingService.getUserAddresses(userId);
            return res.status(400).json({
                error: 'No address associated with this booking',
                code: 'ADDRESS_REQUIRED',
                addresses: userAddresses
            });
        }
        console.log(`[Slots] Address found: ${address.pincode}`);
        // 3. Get Zone ID
        const zoneId = await booking_service_1.BookingService.getZoneId(address.lat || '28.6139', address.long || '77.2090', address.pincode);
        if (!zoneId) {
            return res.status(400).json({ error: 'Could not determine zone_id for rescheduling' });
        }
        console.log(`[Slots] Zone ID: ${zoneId}`);
        // 4. Prepare Packages
        const patientGroups = new Map();
        booking.items.forEach((item) => {
            if (!patientGroups.has(item.patientId)) {
                patientGroups.set(item.patientId, []);
            }
            patientGroups.get(item.patientId).push(item.testCode);
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
    }
    catch (error) {
        console.error('Fetch Reschedulable Slots Error:', error);
        res.status(500).json({ error: 'Failed to fetch available slots for rescheduling' });
    }
}
