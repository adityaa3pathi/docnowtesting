import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { describeDb, makeAddress, makeBooking, makePatient, makeUser, resetCommerceData, testDb } from '../../test/db';

const m = vi.hoisted(() => ({ bonus: vi.fn(), ingest: vi.fn(), alerts: [] as { name: string; data: any }[] }));

vi.mock('../../utils/referralService', () => ({ tryAwardFirstOrderBonus: m.bonus }));
vi.mock('../../services/reportIngestion', () => ({ ingestReport: m.ingest }));
vi.mock('../../services/phleboNotifications', () => ({ sendPhleboAssignedViaWhatsApp: vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({
    logAlert: (name: string, data: any) => void m.alerts.push({ name, data }),
    logBusinessEvent: vi.fn(),
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

process.env.HEALTHIANS_WEBHOOK_SECRET = 'webhook-test-secret';
const { healthiansWebhookHandler } = await import('./healthians');

let url = '';
let server: import('http').Server;

/** The real app mounts this with express.raw so the signature can be hashed; mirror that here. */
async function startWebhookServer() {
    const app = express();
    app.post('/webhooks/healthians', express.raw({ type: '*/*' }), healthiansWebhookHandler);
    server = await new Promise<import('http').Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/healthians`;
}

const statusPayload = (partnerBookingId: string, over: object = {}) => ({
    type: 'status_updated',
    booking_id: partnerBookingId,
    data: { booking_status: 'BS005', payment_status: true, paid_amount: '849', remark: '', ref_booking_id: '0', ...over },
});

const send = (payload: unknown) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-healthians-secret': 'webhook-test-secret' },
    body: JSON.stringify(payload),
});

describeDb('pay on collection through the Healthians webhook (real Postgres)', () => {
    beforeEach(async () => {
        await resetCommerceData();
        await testDb.webhookEventV2.deleteMany({});
        m.bonus.mockReset().mockResolvedValue(undefined);
        m.ingest.mockReset();
        m.alerts.length = 0;
        if (!url) await startWebhookServer();
    });

    afterAll(async () => {
        await new Promise<void>((r) => server?.close(() => r()));
        await testDb?.$disconnect();
    });

    async function codBooking(over: Parameters<typeof makeBooking>[0] | object = {}) {
        const user = await makeUser();
        const address = await makeAddress(user.id);
        const patient = await makePatient(user.id);
        const booking = await makeBooking({
            userId: user.id,
            addressId: address.id,
            paymentMethod: 'PAY_ON_COLLECTION',
            finalAmount: 849,
            partnerBookingId: `HB-${user.id.slice(0, 8)}`,
            items: [{ testCode: 'DEAL1', testName: 'CBC', price: 999, patientId: patient.id }],
            ...over,
        } as any);
        return { user, booking };
    }

    it('records the collection once, and ignores a repeat of the same payload', async () => {
        const { booking } = await codBooking();
        expect((await send(statusPayload(booking.partnerBookingId!))).status).toBe(200);

        const collected = await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(collected.collectedAt).toBeInstanceOf(Date);
        expect(collected.collectedAmount).toBe(849);
        expect(collected.paidAt).toBeInstanceOf(Date);

        const repeat = await send(statusPayload(booking.partnerBookingId!));
        expect(await repeat.json()).toEqual({ status: 'duplicate' });
        const after = await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(after.collectedAt!.getTime()).toBe(collected.collectedAt!.getTime());
        expect(m.bonus).toHaveBeenCalledTimes(1);
    });

    it('does not record a second collection even when a different payload arrives', async () => {
        const { booking } = await codBooking();
        await send(statusPayload(booking.partnerBookingId!));
        const first = await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } });
        await send(statusPayload(booking.partnerBookingId!, { paid_amount: '900', remark: 'second look' }));

        const after = await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(after.collectedAmount).toBe(first.collectedAmount);
        expect(after.collectedAt!.getTime()).toBe(first.collectedAt!.getTime());
        expect(m.bonus).toHaveBeenCalledTimes(1);
    });

    it('raises an alert and leaves the booking unpaid when the collector took too little', async () => {
        const { booking } = await codBooking();
        await send(statusPayload(booking.partnerBookingId!, { paid_amount: '400' }));

        const after = await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(after.collectedAt).toBeNull();
        expect(after.collectedAmount).toBeNull();
        expect(m.alerts.map((a) => a.name)).toContain('pay_on_collection_short_payment');
        expect(m.bonus).not.toHaveBeenCalled();
    });

    it('leaves the booking unpaid while Healthians still reports payment_status false', async () => {
        const { booking } = await codBooking();
        await send(statusPayload(booking.partnerBookingId!, { payment_status: false, paid_amount: '0' }));

        expect((await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } })).collectedAt).toBeNull();
        expect(m.alerts.map((a) => a.name)).not.toContain('pay_on_collection_short_payment');
        expect(m.bonus).not.toHaveBeenCalled();
    });

    it('never marks an online booking as collected, whatever the payload says', async () => {
        const { booking } = await codBooking({ paymentMethod: 'ONLINE', razorpayPaymentId: 'pay_online_1' });
        await send(statusPayload(booking.partnerBookingId!));

        const after = await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(after.collectedAt).toBeNull();
        expect(after.collectedAmount).toBeNull();
        expect(after.partnerStatus).toBe('BS005');
        expect(m.bonus).not.toHaveBeenCalled();
    });
});
