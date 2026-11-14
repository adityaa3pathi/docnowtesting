import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * With Redis down, cancel, reschedule and status must still work: a lost limit
 * beats a customer who cannot cancel. The limiters are null without Upstash
 * credentials, so these tests drive underLimit through a limiter that throws.
 */
const m = vi.hoisted(() => ({ cancel: vi.fn(), details: vi.fn(), warns: [] as unknown[] }));

vi.mock('../../db', () => ({ prisma: { booking: { findFirst: vi.fn(async () => null) } } }));
vi.mock('../../services/bookingCancellation', () => ({ cancelCustomerBooking: m.cancel }));
vi.mock('../../services/booking.service', () => ({ BookingService: { getBookingWithDetails: m.details } }));
vi.mock('../../utils/logger', () => ({
    logAlert: vi.fn(),
    logBusinessEvent: vi.fn(),
    logger: { warn: (data: unknown) => void m.warns.push(data), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { underLimit } = await import('../../utils/rateLimit');
const { cancelBooking } = await import('./cancel');

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const fakeRes = () => {
    const res: any = { statusCode: 200, body: null };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: unknown) => { res.body = body; return res; };
    return res;
};
const downLimiter = { limit: async () => { throw new TypeError('fetch failed'); } } as any;

beforeEach(() => {
    m.cancel.mockReset().mockResolvedValue({ message: 'Order cancelled successfully.', bookingStatus: 'Cancelled', paymentStatus: 'CANCELLED', refundStatus: 'not_applicable', manualRefundRequired: false, partnerCancellation: 'not_required' });
    m.details.mockReset();
    m.warns.length = 0;
});

describe('rate limits when Redis is unreachable', () => {
    it('lets cancel, reschedule and status through and logs the outage once each', async () => {
        for (const key of ['cancel:u1', 'reschedule:u1', 'status:u1']) {
            expect(await underLimit(downLimiter, key)).toBe(true);
        }
        expect(m.warns).toHaveLength(3);
    });

    it('does not report the Redis key itself, only its route prefix', async () => {
        await underLimit(downLimiter, 'cancel:user-abc-123');
        expect(m.warns[0]).toMatchObject({ key: 'cancel' });
    });

    it('still honours a limiter that answers with a refusal', async () => {
        const full = { limit: async () => ({ success: false }) } as any;
        expect(await underLimit(full, 'cancel:u1')).toBe(false);
        expect(m.warns).toHaveLength(0);
    });

    it('cancels a booking when no limiter is configured at all', async () => {
        const res = fakeRes();
        await cancelBooking({ userId: 'u1', params: { id: BOOKING_ID }, body: { remarks: 'change of plans' } } as any, res);

        expect(res.statusCode).toBe(200);
        expect(m.cancel).toHaveBeenCalledWith({ bookingId: BOOKING_ID, userId: 'u1', remarks: 'change of plans' });
    });

    it('still refuses a cancel with no reason, before any limiter runs', async () => {
        const res = fakeRes();
        await cancelBooking({ userId: 'u1', params: { id: BOOKING_ID }, body: { remarks: 'no' } } as any, res);

        expect(res.statusCode).toBe(400);
        expect(m.cancel).not.toHaveBeenCalled();
    });
});
