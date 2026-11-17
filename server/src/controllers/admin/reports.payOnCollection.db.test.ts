import { afterAll, beforeEach, expect, it } from 'vitest';
import { describeDb, makeAddress, makeBooking, makeCatalogItem, makePatient, makeUser, resetCommerceData, testDb } from '../../test/db';
import { buildSalesReportRows } from './salesReport';
import { buildSettlementRows } from './settlementReport';

describeDb('what the reports say about pay on collection (real Postgres)', () => {
    beforeEach(resetCommerceData);
    afterAll(async () => testDb?.$disconnect());

    async function booking(over: Record<string, unknown>) {
        const user = await makeUser();
        const address = await makeAddress(user.id);
        const patient = await makePatient(user.id);
        await makeCatalogItem('DEAL1', 1000);
        return makeBooking({
            userId: user.id,
            addressId: address.id,
            status: 'Report Generated',
            partnerStatus: 'BS008',
            totalAmount: 1000,
            finalAmount: 1000,
            items: [{ testCode: 'DEAL1', testName: 'CBC', price: 1000, patientId: patient.id }],
            ...over,
        } as any);
    }

    it('counts pay-on-collection revenue only once the collector reports the money', async () => {
        await booking({ paymentMethod: 'PAY_ON_COLLECTION', paymentStatus: 'PAID', collectedAt: null });
        const beforeCollection = await buildSalesReportRows({});
        expect(beforeCollection[0].revenueCollected).toBe(0);
        expect(beforeCollection[0].totalTestsBooked).toBe(1);

        await booking({ paymentMethod: 'PAY_ON_COLLECTION', paymentStatus: 'PAID', collectedAt: new Date(), collectedAmount: 1000 });
        const afterCollection = await buildSalesReportRows({});
        expect(afterCollection[0].revenueCollected).toBe(1000);
        expect(afterCollection[0].averageOrderValue).toBe(1000);
        expect(afterCollection[0].totalTestsBooked).toBe(2);
    });

    it('counts an online confirmed booking as revenue straight away', async () => {
        await booking({ paymentMethod: 'ONLINE', paymentStatus: 'CONFIRMED' });
        expect((await buildSalesReportRows({}))[0].revenueCollected).toBe(1000);
    });

    it('labels the settlement payment mode by whether the money has been taken', async () => {
        const uncollected = await booking({ paymentMethod: 'PAY_ON_COLLECTION', paymentStatus: 'PAID', collectedAt: null });
        const collected = await booking({ paymentMethod: 'PAY_ON_COLLECTION', paymentStatus: 'PAID', collectedAt: new Date(), collectedAmount: 1000 });
        const online = await booking({ paymentMethod: 'ONLINE', paymentStatus: 'CONFIRMED' });

        const byBooking = new Map((await buildSettlementRows({})).map((r) => [r.bookingId, r.paymentMode]));
        expect(byBooking.get(uncollected.id)).toBe('Pay on collection (not yet collected)');
        expect(byBooking.get(collected.id)).toBe('Pay on collection (collected)');
        expect(byBooking.get(online.id)).toBe('Razorpay Online');
    });

    it('still calls a fully wallet-paid order Wallet, not pay on collection', async () => {
        const wallet = await booking({ paymentMethod: 'ONLINE', paymentStatus: 'CONFIRMED', finalAmount: 0, walletAmount: 1000, razorpayPaymentId: 'ZERO_x' });
        const rows = await buildSettlementRows({});
        expect(rows.find((r) => r.bookingId === wallet.id)?.paymentMode).toBe('Wallet');
    });
});
