import { createHmac, randomUUID } from 'crypto';
import express from 'express';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { useTestJwtSecret } from './test/http';

useTestJwtSecret();
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
const SECRET = 'whsec_test';

const signBody = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');

describeDb('consultation webhook (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let webhook: typeof import('./consultations.webhook');
    let razorpay: FakeRazorpay;
    let server: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        webhook = await import('./consultations.webhook');
        const { webhookHandler } = await import('../../controllers/payments/webhook');
        const app = express();
        app.post('/hook', express.raw({ type: 'application/json' }), webhookHandler);
        const s = await new Promise<import('http').Server>((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
        server = { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => s.close(() => r())) };
    });
    afterAll(async () => {
        await server?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
        await resetConsultData();
        await testDb.webhookEventV2.deleteMany({ where: { source: 'razorpay_consult' } });
        await testDb.webhookEvent.deleteMany({ where: { eventId: { startsWith: 'evt_lab' } } });
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    async function booked(key = 'key-hook-12345') {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, 24 * 60);
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: key }, { razorpay });
        return { doctor, user, patient, slot, res, orderId: res.razorpayOrderId!, fee: res.amountPaise };
    }
    const captured = (b: { orderId: string; fee: number }, paymentId = 'pay_hook0000001', extra: Record<string, unknown> = {}) => ({
        event: 'payment.captured',
        payload: { payment: { entity: { id: paymentId, order_id: b.orderId, amount: b.fee, currency: 'INR', status: 'captured', ...extra } } },
    });
    const send = (payload: unknown, opts: { eventId?: string; secret?: string; signature?: string | null } = {}) => {
        const body = JSON.stringify(payload);
        const headers: Record<string, string> = { 'content-type': 'application/json', 'x-razorpay-event-id': opts.eventId ?? `evt_${randomUUID()}` };
        if (opts.signature !== null) headers['x-razorpay-signature'] = opts.signature ?? signBody(body, opts.secret);
        return fetch(`${server.url}/hook`, { method: 'POST', headers, body });
    };
    const status = async (id: string) => (await testDb.consultation.findUniqueOrThrow({ where: { id } })).status;

    it('applies the same event once and replies success both times', async () => {
        const b = await booked();
        const first = await send(captured(b), { eventId: 'evt_dup_1' });
        const second = await send(captured(b), { eventId: 'evt_dup_1' });
        expect(first.status).toBe(200);
        expect(await second.json()).toEqual({ status: 'duplicate' });
        expect(await status(b.res.consultationId)).toBe('CONFIRMED');
        expect(await testDb.webhookEventV2.count({ where: { source: 'razorpay_consult' } })).toBe(1);
        expect(await testDb.consultationRefund.count()).toBe(0);
    });

    it('confirms on payment captured before verify, then verify is a no-op', async () => {
        const b = await booked();
        await send(captured(b));
        expect(await status(b.res.consultationId)).toBe('CONFIRMED');
        razorpay.addPayment(b.orderId, { id: 'pay_hook0000001', amount: b.fee });
        const sig = createHmac('sha256', 'test_key_secret').update(`${b.orderId}|pay_hook0000001`).digest('hex');
        const out = await payments.verifyAndConfirm(b.user.id, b.res.consultationId, { razorpay_payment_id: 'pay_hook0000001', razorpay_signature: sig }, { razorpay });
        expect(out.outcome).toBe('already');
    });

    it('matches a refund event to our record through the receipt before the Razorpay id is stored', async () => {
        const b = await booked();
        await payments.confirmPayment({ paymentId: 'pay_hook0000001', orderId: b.orderId, amountPaise: b.fee, currency: 'INR' });
        const pay = await testDb.consultationPayment.findUniqueOrThrow({ where: { razorpayPaymentId: 'pay_hook0000001' } });
        await testDb.consultation.update({ where: { id: b.res.consultationId }, data: { status: 'CANCELLED' } });
        await testDb.slot.update({ where: { id: b.slot.id }, data: { status: 'AVAILABLE' } });
        const record = await testDb.consultationRefund.create({
            data: { consultationId: b.res.consultationId, paymentId: pay.id, reason: 'PATIENT_CANCEL', amountPaise: b.fee, receipt: 'rf_receipt_one' },
        });
        await send({
            event: 'refund.processed',
            payload: { refund: { entity: { id: 'rfnd_1', receipt: 'rf_receipt_one', payment_id: 'pay_hook0000001', amount: b.fee, status: 'processed' } } },
        });
        const after = await testDb.consultationRefund.findUniqueOrThrow({ where: { id: record.id } });
        expect(after).toMatchObject({ status: 'PROCESSED', razorpayRefundId: 'rfnd_1' });
        expect(await status(b.res.consultationId)).toBe('REFUNDED');
    });

    it('records a refund made by hand in the dashboard as external', async () => {
        const b = await booked();
        await payments.confirmPayment({ paymentId: 'pay_hook0000001', orderId: b.orderId, amountPaise: b.fee, currency: 'INR' });
        await send({
            event: 'refund.processed',
            payload: { refund: { entity: { id: 'rfnd_manual', payment_id: 'pay_hook0000001', amount: 20000, status: 'processed' } } },
        });
        const rows = await testDb.consultationRefund.findMany();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ reason: 'EXTERNAL', amountPaise: 20000, status: 'PROCESSED', razorpayRefundId: 'rfnd_manual' });
        expect(await status(b.res.consultationId)).toBe('CONFIRMED');
    });

    it('does not undo a confirmation when payment failed arrives later', async () => {
        const b = await booked();
        await send(captured(b));
        await send({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_hook0000009', order_id: b.orderId, amount: b.fee, currency: 'INR', status: 'failed' } } } });
        expect(await status(b.res.consultationId)).toBe('CONFIRMED');
    });

    it('handles a refund event with no payment entity without crashing', async () => {
        const res = await send({ event: 'refund.created', payload: { refund: { entity: { id: 'rfnd_nothing', payment_id: 'pay_unknown00001', amount: 100, notes: { kind: 'consult' } } } } });
        expect(res.status).toBe(200);
    });

    it('replies 200 and changes nothing for an unknown order marked as consultation', async () => {
        const res = await send({ event: 'order.paid', payload: { order: { entity: { id: 'order_unknown', notes: { kind: 'consult' } } }, payment: { entity: { id: 'pay_unknown00002', order_id: 'order_unknown', amount: 100, currency: 'INR', status: 'captured' } } } });
        expect(res.status).toBe(200);
        expect(await testDb.consultationPayment.count()).toBe(0);
    });

    it('leaves no dedupe row after a failure, and processes the retry', async () => {
        const b = await booked();
        const payload = captured(b);
        const failing = new Proxy(testDb, {
            get(target: any, prop) {
                if (prop !== '$transaction') return target[prop];
                return (fn: (tx: any) => Promise<unknown>) =>
                    target.$transaction((tx: any) =>
                        fn(new Proxy(tx, {
                            get(t: any, p) {
                                if (p !== 'webhookEventV2') return t[p];
                                return new Proxy(t.webhookEventV2, { get: (d: any, m) => (m === 'update' ? () => { throw new Error('boom'); } : d[m]) });
                            },
                        })),
                    );
            },
        }) as typeof testDb;
        await expect(webhook.tryHandleConsultEvent(payload, 'evt_retry_1', failing)).rejects.toThrow('boom');
        expect(await testDb.webhookEventV2.count({ where: { source: 'razorpay_consult' } })).toBe(0);
        expect(await status(b.res.consultationId)).toBe('PENDING_PAYMENT');
        const retry = await webhook.tryHandleConsultEvent(payload, 'evt_retry_1', testDb);
        expect(retry).toMatchObject({ handled: true, status: 200 });
        expect(await status(b.res.consultationId)).toBe('CONFIRMED');
    });

    it('processes a recorded but unprocessed event on retry instead of skipping it', async () => {
        const b = await booked();
        await testDb.webhookEventV2.create({ data: { payloadHash: 'consult:evt_stuck_1', source: 'razorpay_consult', eventType: 'payment.captured', processed: false } });
        await send(captured(b), { eventId: 'evt_stuck_1' });
        expect(await status(b.res.consultationId)).toBe('CONFIRMED');
        expect((await testDb.webhookEventV2.findUniqueOrThrow({ where: { payloadHash: 'consult:evt_stuck_1' } })).processed).toBe(true);
    });

    it('stores no payer contact or card details', async () => {
        const b = await booked();
        await send(captured(b, 'pay_hook0000001', { contact: '+919999999999', email: 'p@example.com', card: { last4: '4242' }, vpa: 'a@upi' }), { eventId: 'evt_pii_1' });
        const row = await testDb.webhookEventV2.findUniqueOrThrow({ where: { payloadHash: 'consult:evt_pii_1' } });
        const text = JSON.stringify(row.rawPayload);
        for (const secret of ['9999999999', 'example.com', '4242', 'a@upi']) expect(text).not.toContain(secret);
        expect(row.rawPayload).toMatchObject({ paymentId: 'pay_hook0000001', amount: b.fee });
    });

    describe('signature and lab path', () => {
        it('rejects a bad signature and a missing signature, and writes nothing', async () => {
            const b = await booked();
            expect((await send(captured(b), { signature: 'a'.repeat(64) })).status).toBe(401);
            expect((await send(captured(b), { signature: null })).status).toBe(401);
            expect(await status(b.res.consultationId)).toBe('PENDING_PAYMENT');
            expect(await testDb.webhookEventV2.count({ where: { source: 'razorpay_consult' } })).toBe(0);
        });

        it('rejects every call when the webhook secret is empty', async () => {
            const b = await booked();
            process.env.RAZORPAY_WEBHOOK_SECRET = '';
            expect((await send(captured(b), { secret: '' })).status).toBe(401);
            expect(await status(b.res.consultationId)).toBe('PENDING_PAYMENT');
        });

        it('leaves no row in the lab dedupe table for a consultation event', async () => {
            const b = await booked();
            await send(captured(b), { eventId: 'evt_labcheck_consult' });
            expect(await testDb.webhookEvent.count({ where: { eventId: 'evt_labcheck_consult' } })).toBe(0);
        });

        it('still sends a lab event to the lab path', async () => {
            const res = await send(
                { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_lab0000001', order_id: 'order_lab_unknown', amount: 100, currency: 'INR', status: 'captured' } } } },
                { eventId: 'evt_lab_1' },
            );
            expect(res.status).toBe(200);
            expect(await testDb.webhookEvent.count({ where: { eventId: 'evt_lab_1' } })).toBe(1);
        });

        it('still sends an event with no payment entity and no consultation ids to the lab path', async () => {
            await send({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_lab', payment_id: 'pay_lab_other', amount: 100 } } } }, { eventId: 'evt_lab_2' });
            expect(await testDb.webhookEvent.count({ where: { eventId: 'evt_lab_2' } })).toBe(1);
        });
    });
});
