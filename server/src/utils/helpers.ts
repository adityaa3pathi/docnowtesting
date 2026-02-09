import { z } from 'zod';

/**
 * Helper for retrying partner API calls with exponential backoff
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 1000
): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        if (retries === 0) throw error;
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
export const validationSchemas = {
    uuid: z.string().uuid(),

    cancelBooking: z.object({
        bookingId: z.string().uuid(),
        remarks: z.string().optional()
    }),

    rescheduleBooking: z.object({
        slot_id: z.coerce.string(),
        slotDate: z.string(),
        slotTime: z.string(),
        reschedule_reason: z.string().min(5)
    })
};

/**
 * Normalize gender to Healthians format
 */
export function normalizeGender(g?: string | null): string {
    if (!g) return 'M';
    const gender = g.toLowerCase();
    if (gender.startsWith('f')) return 'F';
    return 'M';
}

/**
 * Mask phone number for privacy (show last 4 digits)
 */
export function maskPhoneNumber(phone: string): string {
    if (!phone || phone.length < 4) return '****';
    return '******' + phone.slice(-4);
}
