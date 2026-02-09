"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rescheduleBooking = rescheduleBooking;
const db_1 = require("../../db");
const healthians_1 = require("../../adapters/healthians");
const helpers_1 = require("../../utils/helpers");
const booking_service_1 = require("../../services/booking.service");
const ratelimit_1 = require("@upstash/ratelimit");
const redis_1 = require("@upstash/redis");
const healthians = healthians_1.HealthiansAdapter.getInstance();
// Rate limiter for reschedule
const rescheduleRateLimit = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new ratelimit_1.Ratelimit({
        redis: redis_1.Redis.fromEnv(),
        limiter: ratelimit_1.Ratelimit.slidingWindow(3, '1m'),
        prefix: 'ratelimit:reschedule',
    }) : null;
// Non-reschedulable statuses
const NON_RESCHEDULABLE_STATUSES = ['Cancelled', 'Sample Collected', 'Report Generated', 'Completed', 'Rescheduled'];
/**
 * POST /api/bookings/:id/reschedule - Reschedule Booking
 */
async function rescheduleBooking(req, res) {
    try {
        const userId = req.userId;
        const bookingId = req.params.id;
        const { slot_id, slotDate, slotTime, reschedule_reason } = req.body;
        // 1. Validation
        const parse = helpers_1.validationSchemas.rescheduleBooking.safeParse({ slot_id, slotDate, slotTime, reschedule_reason });
        if (!parse.success) {
            return res.status(400).json({ error: parse.error.issues[0].message });
        }
        // 2. Rate Limiting
        if (rescheduleRateLimit) {
            const { success } = await rescheduleRateLimit.limit(`reschedule:${userId}`);
            if (!success) {
                return res.status(429).json({ error: 'Too many reschedule attempts. Please wait a minute.' });
            }
        }
        // 3. Ownership & Eligibility Check
        const booking = await db_1.prisma.booking.findFirst({
            where: { id: bookingId, userId: userId },
            include: { items: true }
        });
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        if (NON_RESCHEDULABLE_STATUSES.includes(booking.status)) {
            return res.status(400).json({ error: `Booking cannot be rescheduled in current status: ${booking.status}` });
        }
        if (!booking.partnerBookingId) {
            return res.status(400).json({ error: 'Partner booking ID not found' });
        }
        if (!slot_id) {
            return res.status(400).json({ error: 'Slot ID is required' });
        }
        console.log('[Reschedule Debug] slot_id received:', slot_id);
        // 4. Get customers from Healthians
        const { customers } = await booking_service_1.BookingService.getHealthiansCustomers(booking.partnerBookingId);
        console.log('[Reschedule Debug] Healthians customers:', customers);
        if (customers.length === 0) {
            return res.status(400).json({ error: 'No customers found for this booking' });
        }
        const customersPayload = customers.map((c) => ({
            vendor_customer_id: String(c.vendor_customer_id)
        }));
        const reschedulePayload = {
            booking_id: booking.partnerBookingId,
            slot: { slot_id: String(slot_id) },
            customers: customersPayload,
            reschedule_reason: reschedule_reason
        };
        console.log('[Reschedule API] Payload:', JSON.stringify(reschedulePayload, null, 2));
        // 5. Call Healthians API
        let response;
        try {
            response = await healthians.rescheduleBooking(reschedulePayload);
            console.log('[Reschedule API] Response:', JSON.stringify(response, null, 2));
        }
        catch (apiError) {
            console.error('[Reschedule API] Error:', apiError.response?.data || apiError.message);
            return res.status(400).json({
                error: apiError.response?.data?.message || 'Reschedule failed on partner platform',
                details: apiError.response?.data
            });
        }
        if (response.status && response.data?.new_booking_id) {
            const newPartnerBookingId = response.data.new_booking_id;
            // 6. Atomic Update
            const result = await db_1.prisma.$transaction(async (tx) => {
                // Create new booking
                const newBooking = await tx.booking.create({
                    data: {
                        userId: userId,
                        partnerBookingId: newPartnerBookingId.toString(),
                        status: 'Order Booked',
                        slotDate: slotDate,
                        slotTime: slotTime,
                        totalAmount: booking.totalAmount,
                        paymentStatus: booking.paymentStatus,
                        razorpayOrderId: booking.razorpayOrderId,
                        items: {
                            create: booking.items.map(item => ({
                                testCode: item.testCode,
                                testName: item.testName,
                                price: item.price,
                                patientId: item.patientId
                            }))
                        }
                    }
                });
                // Mark old booking as rescheduled
                await tx.booking.update({
                    where: { id: bookingId },
                    data: { status: 'Rescheduled' }
                });
                return newBooking;
            });
            return res.json({
                success: true,
                message: 'Booking rescheduled successfully',
                new_booking_id: result.id
            });
        }
        else {
            return res.status(400).json({ error: response.message || 'Failed to reschedule on partner platform' });
        }
    }
    catch (error) {
        console.error('Reschedule Error:', error);
        res.status(500).json({ error: 'Internal server error while rescheduling' });
    }
}
