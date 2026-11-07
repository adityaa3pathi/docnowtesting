import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ cancel: vi.fn(), refund: vi.fn(), customers: [] as any[], tx: vi.fn() }));

// Any model/method on the fake client resolves to a harmless row, so the success path can run.
const anyModel = () => new Proxy({}, { get: () => vi.fn(async () => ({ count: 1 })) });
vi.mock('../db', () => ({
    prisma: new Proxy({
        booking: {
            findFirst: vi.fn(async () => ({
                id: 'b1', userId: 'u1', partnerBookingId: 'HB1', partnerStatus: 'BS002', status: 'Order Booked',
                paymentStatus: 'CONFIRMED', razorpayPaymentId: 'pay_1', managerOrder: null, campId: null,
            })),
            updateMany: vi.fn(async () => ({ count: 1 })),
            update: vi.fn(async () => ({})),
        },
        $transaction: async (fn: any) => { m.tx(); return fn(new Proxy({}, { get: () => anyModel() })); },
    }, { get: (t: any, k) => (k in t ? t[k] : anyModel()) }),
}));
vi.mock('../adapters/healthians', () => ({ HealthiansAdapter: { getInstance: () => ({ cancelBooking: m.cancel }) } }));
vi.mock('./booking.service', () => ({ BookingService: { getHealthiansCustomers: async () => ({ customers: m.customers, bookingStatus: 'BS002' }) } }));
vi.mock('./razorpay', () => ({ getRazorpay: () => ({ payments: { refund: m.refund } }) }));
vi.mock('./bookingStrategyRegistry', () => ({ getBookingStrategy: () => ({ canCustomerCancel: () => ({ allowed: true }) }) }));
vi.mock('../utils/helpers', () => ({ retryWithBackoff: (fn: () => unknown) => fn() }));
vi.mock('./bookingCancellationNotifications', () => ({ sendBookingCancelledViaWhatsApp: vi.fn(async () => {}) }));
vi.mock('../utils/logger', () => ({ logAlert: vi.fn(), logBusinessEvent: vi.fn(), logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { cancelCustomerBooking } = await import('./bookingCancellation');
const run = () => cancelCustomerBooking({ bookingId: 'b1', userId: 'u1', remarks: 'change of plans' });

beforeEach(() => {
    m.cancel.mockReset();
    m.refund.mockReset().mockResolvedValue({});
    m.tx.mockReset();
    m.customers = [{ vendor_customer_id: 'c1', customer_status: 'BS002' }, { vendor_customer_id: 'c2', customer_status: 'BS002' }];
});

describe('customer cancellation with the lab', () => {
    it('does not refund or cancel locally when the lab refuses (HTTP 200, status false)', async () => {
        m.cancel.mockResolvedValue({ status: false, message: 'Phlebo already assigned' });
        await expect(run()).rejects.toThrow('did not cancel');
        expect(m.refund).not.toHaveBeenCalled();
        expect(m.tx).not.toHaveBeenCalled();
    });

    it('does not refund when only some patients were cancelled', async () => {
        m.cancel.mockResolvedValueOnce({ status: true }).mockResolvedValueOnce({ status: false });
        await expect(run()).rejects.toThrow('cancelled 1 of 2');
        expect(m.refund).not.toHaveBeenCalled();
    });

    it('refunds once every patient is cancelled', async () => {
        m.cancel.mockResolvedValue({ status: true, message: 'ok' });
        await run();
        expect(m.refund).toHaveBeenCalledWith('pay_1', expect.anything());
    });
});
