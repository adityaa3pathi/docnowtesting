"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelBooking = cancelBooking;
const db_1 = require("../../db");
const healthians_1 = require("../../adapters/healthians");
const helpers_1 = require("../../utils/helpers");
const booking_service_1 = require("../../services/booking.service");
const ratelimit_1 = require("@upstash/ratelimit");
const redis_1 = require("@upstash/redis");
const zod_1 = require("zod");
const healthians = healthians_1.HealthiansAdapter.getInstance();
// Rate limiter for cancellation
const cancelRateLimit = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new ratelimit_1.Ratelimit({
        redis: redis_1.Redis.fromEnv(),
        limiter: ratelimit_1.Ratelimit.slidingWindow(3, '1m'),
        prefix: 'ratelimit:cancel',
    }) : null;
/**
 * POST /api/bookings/:id/cancel - Cancel Booking
 */
async function cancelBooking(req, res) {
    try {
        const userId = req.userId;
        const bookingId = req.params.id;
        const { remarks } = req.body;
        // 1. Validation
        const schema = zod_1.z.object({
            bookingId: zod_1.z.string().uuid(),
            remarks: zod_1.z.string().min(5, "Reason for cancellation must be at least 5 characters long")
        });
        const parseResult = schema.safeParse({ bookingId, remarks });
        if (!parseResult.success) {
            return res.status(400).json({
                error: parseResult.error.issues[0].message
            });
        }
        // 2. Rate Limiting
        if (cancelRateLimit) {
            const { success } = await cancelRateLimit.limit(`cancel:${userId}`);
            if (!success) {
                return res.status(429).json({ error: 'Too many cancellation attempts. Please wait a minute.' });
            }
        }
        // 3. Ownership Check
        const booking = await db_1.prisma.booking.findFirst({
            where: { id: bookingId, userId },
            include: { user: true }
        });
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or access denied' });
        }
        if (!booking.partnerBookingId) {
            return res.status(400).json({ error: 'Internal record error: Partner Booking ID is missing' });
        }
        // 4. Check Current Status
        if (booking.status === 'Cancelled') {
            return res.status(400).json({ error: 'This booking is already cancelled' });
        }
        const { customers, bookingStatus } = await booking_service_1.BookingService.getHealthiansCustomers(booking.partnerBookingId);
        // Allow cancellation only if BS002 or BS005
        if (bookingStatus !== 'BS002' && bookingStatus !== 'BS005') {
            return res.status(400).json({
                error: `Cancellation not allowed. Current status is: ${bookingStatus || 'Unknown'}`
            });
        }
        if (customers.length === 0) {
            return res.status(400).json({ error: 'No active customers found to cancel' });
        }
        // 5. Process Cancellation
        const results = [];
        const failures = [];
        console.log(`Starting cancellation for booking ${booking.partnerBookingId} with ${customers.length} customers`);
        for (const customer of customers) {
            if (customer.customer_status === 'BS0018')
                continue;
            try {
                const cancelRes = await (0, helpers_1.retryWithBackoff)(() => healthians.cancelBooking({
                    booking_id: booking.partnerBookingId,
                    vendor_billing_user_id: userId,
                    vendor_customer_id: customer.vendor_customer_id,
                    remarks: remarks || 'User requested cancellation'
                }));
                results.push({
                    customerId: customer.vendor_customer_id,
                    status: cancelRes.status,
                    message: cancelRes.message
                });
            }
            catch (err) {
                console.error(`Cancellation failed for customer ${customer.vendor_customer_id}:`, err.message);
                failures.push({
                    customerId: customer.vendor_customer_id,
                    error: 'Partner API error'
                });
            }
        }
        // 6. Update Local Database
        if (results.length > 0) {
            await db_1.prisma.booking.update({
                where: { id: bookingId },
                data: { status: 'Cancelled' }
            });
            return res.json({
                message: 'Booking cancellation processed',
                successCount: results.length,
                failureCount: failures.length,
                details: results
            });
        }
        else {
            return res.status(500).json({
                error: 'Failed to cancel any customers on the partner platform',
                details: failures
            });
        }
    }
    catch (error) {
        console.error('Cancel Booking Error:', error);
        res.status(500).json({ error: 'A critical error occurred while processing cancellation' });
    }
}
