"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatus = getStatus;
const db_1 = require("../../db");
const healthians_1 = require("../../adapters/healthians");
const helpers_1 = require("../../utils/helpers");
const booking_service_1 = require("../../services/booking.service");
const ratelimit_1 = require("@upstash/ratelimit");
const redis_1 = require("@upstash/redis");
const healthians = healthians_1.HealthiansAdapter.getInstance();
// Rate limiter for status checks
const statusRateLimit = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new ratelimit_1.Ratelimit({
        redis: redis_1.Redis.fromEnv(),
        limiter: ratelimit_1.Ratelimit.slidingWindow(10, '1m'),
        prefix: 'ratelimit:status',
    }) : null;
// Status code mapping
const STATUS_CODE_TO_LABEL = {
    'BS002': 'Order Booked',
    'BS003': 'Sample Collection Scheduled',
    'BS005': 'Sample Collector Assigned',
    'BS006': 'Sample Collected',
    'BS007': 'Report Generated',
    'BS0018': 'Cancelled',
};
/**
 * GET /api/bookings/:id/status - Track Booking Status
 */
async function getStatus(req, res) {
    try {
        const userId = req.userId;
        const bookingId = req.params.id;
        // 1. Validation
        const parse = helpers_1.validationSchemas.uuid.safeParse(bookingId);
        if (!parse.success) {
            return res.status(400).json({ error: 'Invalid Booking ID format' });
        }
        // 2. Rate Limiting
        if (statusRateLimit) {
            const { success } = await statusRateLimit.limit(`status:${userId}`);
            if (!success) {
                return res.status(429).json({ error: 'Too many status check requests' });
            }
        }
        // 3. Ownership Check with details
        const booking = await booking_service_1.BookingService.getBookingWithDetails(bookingId, userId);
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        if (!booking.partnerBookingId) {
            return res.status(400).json({ error: 'Partner Booking ID missing for this order' });
        }
        // 4. Call Healthians API
        const statusResponse = await healthians.getBookingStatus(booking.partnerBookingId);
        // 5. Sync status to local DB
        const healthiansStatus = statusResponse?.data?.booking_status;
        if (healthiansStatus && STATUS_CODE_TO_LABEL[healthiansStatus]) {
            await db_1.prisma.booking.update({
                where: { id: bookingId },
                data: { status: STATUS_CODE_TO_LABEL[healthiansStatus] }
            });
            console.log(`Synced booking ${bookingId} status to: ${STATUS_CODE_TO_LABEL[healthiansStatus]}`);
        }
        // 6. Build patient details map
        const patientMap = booking_service_1.BookingService.buildPatientMap(booking);
        res.json({
            ...statusResponse,
            patientDetails: patientMap
        });
    }
    catch (error) {
        console.error('Track Status Error:', error);
        res.status(500).json({ error: 'Failed to fetch booking status' });
    }
}
