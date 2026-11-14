import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { describeDb, makeAddress, makeBooking, makePatient, makePromo, makeUser, makeWallet, resetCommerceData, testDb } from '../test/db';

const m = vi.hoisted(() => ({ refund: vi.fn(), cancelWithPartner: vi.fn(), customers: [] as any[], finalizeWithPartner: vi.fn() }));

vi.mock('./razorpay', () => ({ getRazorpay: () => ({ payments: { refund: m.refund }, orders: { create: vi.fn() } }) }));
vi.mock('../adapters/healthians', () => ({ HealthiansAdapter: { getInstance: () => ({ cancelBooking: m.cancelWithPartner }) } }));
vi.mock('./booking.service', () => ({ BookingService: { getHealthiansCustomers: async () => ({ customers: m.customers, bookingStatus: 'BS002' }) } }));
vi.mock('./bookingStrategyRegistry', () => ({
    getBookingStrategy: () => ({ canCustomerCancel: () => ({ allowed: true }), finalizeWithPartner: m.finalizeWithPartner, getConfirmedStatus: () => 'Order Booked' }),
}));
vi.mock('./bookingCancellationNotifications', () => ({ sendBookingCancelledViaWhatsApp: vi.fn(async () => {}) }));
vi.mock('./bookingConfirmationNotifications', () => ({ sendBookingConfirmationViaWhatsApp: vi.fn(async () => {}) }));
vi.mock('../utils/slack', () => ({ sendDeadLetterAlert: vi.fn() }));
vi.mock('../utils/helpers', async (orig) => ({ ...(await orig() as object), retryWithBackoff: (fn: () => unknown) => fn() }));

const { cancelCustomerBooking } = await import('./bookingCancellation');
const { finalizeBooking } = await import('./bookingFinalization');

describeDb('unwinding a pay-on-collection booking (real Postgres)', () => {
    beforeEach(async () => {
        await resetCommerceData();
        m.refund.mockReset().mockResolvedValue({ id: 'rfnd_1' });
        m.cancelWithPartner.mockReset().mockResolvedValue({ status: true, message: 'cancelled' });
        m.finalizeWithPartner.mockReset();
        m.customers = [{ vendor_customer_id: 'c1', customer_status: 'BS002' }];
    });

    afterAll(async () => testDb?.$disconnect());

    /** A pay-on-collection booking that also used 200 of wallet and a promo. */
    async function codBooking(over: Record<string, unknown> = {}) {
        const user = await makeUser();
        const address = await makeAddress(user.id);
        const patient = await makePatient(user.id);
        const promo = await makePromo({ discountValue: 100 });
        await testDb.promoCode.update({ where: { id: promo.id }, data: { redeemedCount: 1 } });
        await makeWallet(user.id, 0);
        const booking = await makeBooking({
            userId: user.id,
            addressId: address.id,
            paymentMethod: 'PAY_ON_COLLECTION',
            paymentStatus: 'PAID',
            status: 'Order Booked',
            totalAmount: 1200,
            discountAmount: 100,
            walletAmount: 200,
            finalAmount: 900,
            promoCodeId: promo.id,
            partnerBookingId: 'HB1',
            items: [{ testCode: 'DEAL1', testName: 'CBC', price: 1200, patientId: patient.id }],
            ...over,
        } as any);
        await testDb.promoRedemption.create({ data: { userId: user.id, promoCodeId: promo.id, bookingId: booking.id } });
        return { user, booking, promo };
    }

    it('cancels without any Razorpay refund, and still gives the wallet and promo back', async () => {
        const { user, booking, promo } = await codBooking({ partnerStatus: 'BS002' });
        const result = await cancelCustomerBooking({ bookingId: booking.id, userId: user.id, remarks: 'change of plans' });

        expect(m.refund).not.toHaveBeenCalled();
        expect(result).toMatchObject({ refundStatus: 'not_applicable', manualRefundRequired: false, paymentStatus: 'CANCELLED' });
        expect((await testDb.wallet.findFirstOrThrow({ where: { userId: user.id } })).balance).toBe(200);
        expect(await testDb.promoRedemption.count({ where: { bookingId: booking.id } })).toBe(0);
        expect((await testDb.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).redeemedCount).toBe(0);
        expect((await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('Cancelled');
    });

    it('does refund an online booking, so the difference is the payment id and nothing else', async () => {
        const { user, booking } = await codBooking({ partnerStatus: 'BS002', paymentStatus: 'CONFIRMED', paymentMethod: 'ONLINE', razorpayPaymentId: 'pay_real_1' });
        const result = await cancelCustomerBooking({ bookingId: booking.id, userId: user.id, remarks: 'change of plans' });

        expect(m.refund).toHaveBeenCalledWith('pay_real_1', expect.anything());
        expect(result).toMatchObject({ refundStatus: 'refunded', paymentStatus: 'REFUNDED' });
    });

    it('restores the wallet and promo once when the lab refuses the booking, with no Razorpay call', async () => {
        const { user, booking, promo } = await codBooking({ partnerBookingId: null });
        m.finalizeWithPartner.mockRejectedValue(new Error('Healthians booking failed'));

        const result = await finalizeBooking(booking.id);

        expect(result.status).toBe('refunded_due_to_partner_error');
        expect(m.refund).not.toHaveBeenCalled();
        const after = await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(after.paymentStatus).toBe('REFUNDED');
        expect((await testDb.wallet.findFirstOrThrow({ where: { userId: user.id } })).balance).toBe(200);
        expect(await testDb.walletLedger.count({ where: { referenceId: booking.id, referenceType: 'REFUND' } })).toBe(1);
        expect((await testDb.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).redeemedCount).toBe(0);
    });
});
