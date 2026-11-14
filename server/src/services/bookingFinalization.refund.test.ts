import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    booking: null as any,
    lease: '' as string,
    finalUpdates: [] as any[],
    refund: vi.fn(),
    rollback: vi.fn(),
    upsertRetry: vi.fn(),
    partner: vi.fn(),
}));

vi.mock('../db', () => ({
    prisma: {
        booking: {
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (data.processingAttemptId) { m.lease = data.processingAttemptId; return { count: 1 }; }
                m.finalUpdates.push(data);
                return { count: where.processingAttemptId === m.lease ? 1 : 0 };
            }),
            findUnique: vi.fn(async () => ({ ...m.booking, processingAttemptId: m.lease })),
        },
        partnerRetry: { upsert: m.upsertRetry },
        managerOrder: { findUnique: vi.fn(async () => null) },
    },
}));
vi.mock('./razorpay', () => ({ getRazorpay: () => ({ payments: { refund: m.refund } }) }));
vi.mock('./rollback', () => ({ rollbackInitiatedBooking: m.rollback }));
vi.mock('./bookingStrategyRegistry', () => ({
    getBookingStrategy: () => ({ finalizeWithPartner: m.partner, getConfirmedStatus: () => 'Order Booked' }),
}));
vi.mock('../utils/slack', () => ({ sendDeadLetterAlert: vi.fn() }));
vi.mock('./bookingConfirmationNotifications', () => ({ sendBookingConfirmationViaWhatsApp: vi.fn(async () => {}) }));
vi.mock('../utils/logger', () => ({ logAlert: vi.fn(), logBusinessEvent: vi.fn(), logger: { warn: vi.fn(), info: vi.fn() } }));

const { finalizeBooking } = await import('./bookingFinalization');

function seed(extra: Record<string, unknown>) {
    m.booking = { id: 'b1', userId: 'u1', partnerBookingId: null, walletAmount: 500, promoCodeId: 'p1', razorpayPaymentId: 'pay_1', ...extra };
}

beforeEach(() => {
    m.finalUpdates = [];
    m.refund.mockReset().mockResolvedValue({});
    m.rollback.mockReset();
    m.upsertRetry.mockReset();
    m.partner.mockReset().mockRejectedValue(new Error('Healthians down'));
});

describe('finalizeBooking when the partner booking fails', () => {
    it('refunds the card and gives back the wallet and promo', async () => {
        seed({});
        const out = await finalizeBooking('b1');
        expect(out.status).toBe('refunded_due_to_partner_error');
        expect(m.refund).toHaveBeenCalledWith('pay_1', expect.anything());
        expect(m.finalUpdates.at(-1).paymentStatus).toBe('REFUNDED');
        expect(m.rollback).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', walletAmount: 500 }));
        expect(m.upsertRetry).not.toHaveBeenCalled();
    });

    it('never sends a card refund for a fully wallet-paid booking, but still returns the wallet', async () => {
        seed({ razorpayPaymentId: 'ZERO_abc' });
        await finalizeBooking('b1');
        expect(m.refund).not.toHaveBeenCalled();
        expect(m.rollback).toHaveBeenCalled();
    });

    it('keeps wallet deducted and queues a retry when the card refund fails', async () => {
        seed({});
        m.refund.mockRejectedValue(new Error('razorpay down'));
        const out = await finalizeBooking('b1');
        expect(out.status).toBe('partner_failed');
        expect(m.finalUpdates.at(-1).paymentStatus).toBe('PARTNER_FAILED');
        expect(m.rollback).not.toHaveBeenCalled();
        expect(m.upsertRetry).toHaveBeenCalled();
    });
});
