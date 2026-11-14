import { afterAll, beforeEach, expect, it } from 'vitest';
import { Router } from 'express';
import { describeDb, makeAddress, makeBooking, makeUser, resetCommerceData, testDb } from '../../test/db';
import { getJson, serve, tokenFor, useTestJwtSecret } from '../../test/http';

useTestJwtSecret();

const { authMiddleware } = await import('../../middleware/auth');
const { getPaymentStatus } = await import('./paymentStatus');

const router = Router();
router.get('/:id/payment-status', authMiddleware, getPaymentStatus as any);

let app: Awaited<ReturnType<typeof serve>>;

describeDb('payment status after a pay-on-collection checkout (real Postgres)', () => {
    beforeEach(async () => {
        await resetCommerceData();
        app = app || (await serve('/bookings', router));
    });

    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });

    async function booking(over: Record<string, unknown>) {
        const user = await makeUser();
        const address = await makeAddress(user.id);
        const row = await makeBooking({ userId: user.id, addressId: address.id, finalAmount: 849, ...over } as any);
        return { user, booking: row, token: tokenFor(user as any) };
    }

    const status = (id: string, token: string) => getJson(`${app.url}/bookings/${id}/payment-status`, token);

    it('tells the customer what the collector will take, until it is taken', async () => {
        const { booking: b, token } = await booking({ paymentMethod: 'PAY_ON_COLLECTION', paymentStatus: 'PAID' });
        const res = await status(b.id, token);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ outcome: 'pending', paymentMethod: 'PAY_ON_COLLECTION', amountDue: 849 });
        expect(res.body.address).toMatchObject({ city: 'Jaipur', pincode: '302001' });
    });

    it('drops the amount due to zero once the collection is recorded', async () => {
        const { booking: b, token } = await booking({ paymentMethod: 'PAY_ON_COLLECTION', paymentStatus: 'CONFIRMED', collectedAt: new Date(), collectedAmount: 849 });
        expect((await status(b.id, token)).body).toMatchObject({ outcome: 'confirmed', amountDue: 0 });
    });

    it('never shows an amount due for an online booking', async () => {
        const { booking: b, token } = await booking({ paymentMethod: 'ONLINE', paymentStatus: 'CONFIRMED' });
        expect((await status(b.id, token)).body).toMatchObject({ paymentMethod: 'ONLINE', amountDue: 0 });
    });

    it('does not show another customer their booking', async () => {
        const { booking: b } = await booking({ paymentMethod: 'PAY_ON_COLLECTION', paymentStatus: 'PAID' });
        const stranger = await makeUser();
        expect((await status(b.id, tokenFor(stranger as any))).status).toBe(404);
    });
});
