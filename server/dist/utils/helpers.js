"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validationSchemas = void 0;
exports.retryWithBackoff = retryWithBackoff;
exports.normalizeGender = normalizeGender;
exports.maskPhoneNumber = maskPhoneNumber;
const zod_1 = require("zod");
/**
 * Helper for retrying partner API calls with exponential backoff
 */
async function retryWithBackoff(fn, retries = 3, delay = 1000) {
    try {
        return await fn();
    }
    catch (error) {
        if (retries === 0)
            throw error;
        const status = error.response?.status;
        if (status && status >= 400 && status < 500 && status !== 429) {
            throw error; // Don't retry client errors (except rate limit)
        }
        await new Promise(res => setTimeout(res, delay));
        return retryWithBackoff(fn, retries - 1, delay * 2);
    }
}
/**
 * Common validation schemas
 */
exports.validationSchemas = {
    uuid: zod_1.z.string().uuid(),
    cancelBooking: zod_1.z.object({
        bookingId: zod_1.z.string().uuid(),
        remarks: zod_1.z.string().optional()
    }),
    rescheduleBooking: zod_1.z.object({
        slot_id: zod_1.z.coerce.string(),
        slotDate: zod_1.z.string(),
        slotTime: zod_1.z.string(),
        reschedule_reason: zod_1.z.string().min(5)
    })
};
/**
 * Normalize gender to Healthians format
 */
function normalizeGender(g) {
    if (!g)
        return 'M';
    const gender = g.toLowerCase();
    if (gender.startsWith('f'))
        return 'F';
    return 'M';
}
/**
 * Mask phone number for privacy (show last 4 digits)
 */
function maskPhoneNumber(phone) {
    if (!phone || phone.length < 4)
        return '****';
    return '******' + phone.slice(-4);
}
