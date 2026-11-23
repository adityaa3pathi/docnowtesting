import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { describeDb, makeAddress, makeBooking, makeUser, resetCommerceData, testDb } from '../test/db';
import { postJson, getJson, serve, tokenFor, useTestJwtSecret } from '../test/http';

useTestJwtSecret();

// The partner booking and Razorpay are outside this test; plain functions survive clearMocks.
const calls = vi.hoisted(() => ({ finalize: 0, razorpay: 0 }));
vi.mock('../services/bookingFinalization', () => ({ finalizeBooking: async () => { calls.finalize++; return { status: 'success' }; } }));
vi.mock('../services/razorpay', () => ({ getRazorpay: () => { calls.razorpay++; throw new Error('Razorpay is not available in tests'); } }));

const { default: managerRouter, CUSTOMER_BLOCKED_MESSAGE } = await import('./manager');

let app: Awaited<ReturnType<typeof serve>>;
let managerToken: string;
let manager: { id: string };

async function customer(status: 'ACTIVE' | 'BLOCKED') {
    const u = await makeUser();
    return testDb.user.update({ where: { id: u.id }, data: { status } });
}
async function order(customerId: string, status: 'CREATED' | 'SENT' | 'PAYMENT_RECEIVED' = 'CREATED') {
    const booking = await makeBooking({ userId: customerId, paymentStatus: 'INITIATED', status: 'PENDING' });
    return testDb.managerOrder.create({
        data: { bookingId: booking.id, managerId: manager.id, customerId, status, totalAmount: 1000, razorpayLinkUrl: 'https://rzp.io/l/test' },
    });
}
const expectBlocked = (res: { status: number; body: any }) => {
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: CUSTOMER_BLOCKED_MESSAGE, code: 'CUSTOMER_BLOCKED' });
};

describeDb('Manager panel: a blocked customer cannot be booked', () => {
    beforeEach(async () => {
        await resetCommerceData();
        calls.finalize = 0;
        calls.razorpay = 0;
        app = app || (await serve('/manager', managerRouter));
        const m = await makeUser({ role: 'MANAGER' });
        manager = m;
        managerToken = tokenFor(m as any);
    });
    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });

    it('customer search shows the blocked status and leaves out deleted accounts', async () => {
        const blocked = await customer('BLOCKED');
        const deleted = await customer('BLOCKED');
        await testDb.user.update({ where: { id: deleted.id }, data: { mobile: `deleted:${deleted.id}` } });
        const res = await getJson(`${app.url}/manager/users/search?mobile=${blocked.mobile.slice(0, 6)}`, managerToken);
        expect(res.status).toBe(200);
        expect(res.body).toContainEqual({ id: blocked.id, name: blocked.name, mobile: blocked.mobile, status: 'BLOCKED' });
        const all = await getJson(`${app.url}/manager/users/search?mobile=${encodeURIComponent('-')}`, managerToken);
        expect(all.body.map((u: { id: string }) => u.id)).not.toContain(deleted.id);
    });

    it('refuses a new lab order, and lets an active customer past the check', async () => {
        const blocked = await customer('BLOCKED');
        const address = await makeAddress(blocked.id);
        const body = { addressId: address.id, slotDate: '2026-12-01', slotTime: '09:00', items: [{ testCode: 'T1', patientId: 'self' }] };
        expectBlocked(await postJson(`${app.url}/manager/orders`, { ...body, userId: blocked.id }, managerToken));
        expect(await testDb.managerOrder.count()).toBe(0);
        expect(await testDb.booking.count({ where: { userId: blocked.id } })).toBe(0);

        const active = await customer('ACTIVE');
        const res = await postJson(`${app.url}/manager/orders`, { ...body, userId: active.id, addressId: randomUUID() }, managerToken);
        expect(res.status).toBe(404); // reaches the next check (the address)
        expect(res.body.error).toBe('Address not found');
    });

    it('refuses a new camp order', async () => {
        const blocked = await customer('BLOCKED');
        expectBlocked(await postJson(`${app.url}/manager/camps/orders`, { userId: blocked.id, campId: randomUUID(), patientId: 'self' }, managerToken));
        const active = await customer('ACTIVE');
        const res = await postJson(`${app.url}/manager/camps/orders`, { userId: active.id, campId: randomUUID(), patientId: 'self' }, managerToken);
        expect(res.body.error).toBe('Camp not found');
    });

    it('refuses a payment link and sending it for an order made before the block', async () => {
        const blocked = await customer('BLOCKED');
        const o = await order(blocked.id);
        expectBlocked(await postJson(`${app.url}/manager/orders/${o.id}/payment-link`, {}, managerToken));
        expectBlocked(await postJson(`${app.url}/manager/orders/${o.id}/send-whatsapp-link`, {}, managerToken));
        expect(calls.razorpay).toBe(0);
    });

    it('refuses an offline cash or UPI confirmation, and changes nothing', async () => {
        const blocked = await customer('BLOCKED');
        const o = await order(blocked.id, 'SENT');
        for (const collectionMode of ['OFFLINE_CASH', 'OFFLINE_UPI']) {
            expectBlocked(await postJson(`${app.url}/manager/orders/${o.id}/confirm-payment`, { collectionMode }, managerToken));
        }
        expect((await testDb.managerOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('SENT');
        expect(calls.finalize).toBe(0);
    });

    it('still confirms a link payment the customer made before the block, so the money is not stranded', async () => {
        const blocked = await customer('BLOCKED');
        const o = await order(blocked.id, 'PAYMENT_RECEIVED');
        const res = await postJson(`${app.url}/manager/orders/${o.id}/confirm-payment`, { collectionMode: 'RAZORPAY_LINK' }, managerToken);
        expect(res.status).toBe(200);
        expect(calls.finalize).toBe(1);
        expect((await testDb.managerOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CONFIRMED');
    });
});
