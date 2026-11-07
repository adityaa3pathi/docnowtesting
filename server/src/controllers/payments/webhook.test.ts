import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    booking: null as any,
    created: vi.fn(),
    deleted: vi.fn(),
    refund: vi.fn(),
    findFirst: vi.fn(),
}));

vi.mock('razorpay', () => ({ default: { validateWebhookSignature: () => true } }));
vi.mock('../../db', () => ({
    prisma: {
        webhookEvent: { create: m.created, delete: m.deleted },
        booking: { findFirst: m.findFirst, update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
        managerOrder: { updateMany: vi.fn(async () => ({ count: 1 })) },
    },
}));
vi.mock('../../services/razorpay', () => ({ getRazorpay: () => ({ payments: { refund: m.refund } }) }));
vi.mock('../../services/bookingFinalization', () => ({ finalizeBooking: vi.fn() }));
vi.mock('../../services/rollback', () => ({ rollbackInitiatedBooking: vi.fn() }));
vi.mock('../../utils/referralService', () => ({ tryAwardFirstOrderBonus: vi.fn() }));
vi.mock('../../utils/logger', () => ({ logAlert: vi.fn(), logBusinessEvent: vi.fn(), logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../utils/sentry', () => ({ addObservabilityBreadcrumb: vi.fn() }));

const { webhookHandler } = await import('./webhook');

function call(payload: unknown) {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    res.end = () => res;
    const req: any = { headers: { 'x-razorpay-signature': 'sig', 'x-razorpay-event-id': 'evt_1' }, body: Buffer.from(JSON.stringify(payload)) };
    return webhookHandler(req, res).then(() => res);
}

const captured = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_9', order_id: 'order_1' } } } };

beforeEach(() => {
    m.created.mockReset().mockResolvedValue({});
    m.deleted.mockReset().mockResolvedValue({});
    m.refund.mockReset().mockResolvedValue({});
    m.findFirst.mockReset();
});

describe('Razorpay lab webhook', () => {
    it('removes its dedupe row when processing fails, so Razorpay\'s retry is processed', async () => {
        m.findFirst.mockRejectedValue(new Error('db blip'));
        const res = await call(captured);
        expect(res.statusCode).toBe(500);
        expect(m.deleted).toHaveBeenCalledWith({ where: { eventId: 'evt_1' } });
    });

    it('refunds a capture that lands after the booking expired', async () => {
        m.findFirst.mockResolvedValue({ id: 'b1', paymentStatus: 'EXPIRED', razorpayPaymentId: null });
        const res = await call(captured);
        expect(res.statusCode).toBe(200);
        expect(m.refund).toHaveBeenCalledWith('pay_9', expect.anything());
    });

    it('answers events without a payment entity instead of crashing', async () => {
        const res = await call({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1' } } } });
        expect(res.statusCode).toBe(200);
        expect(m.deleted).not.toHaveBeenCalled();
    });
});
