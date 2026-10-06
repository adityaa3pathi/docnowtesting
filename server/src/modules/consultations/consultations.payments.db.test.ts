import { createHmac } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';

const sign = (orderId: string, paymentId: string) => createHmac('sha256', 'test_key_secret').update(`${orderId}|${paymentId}`).digest('hex');

describeDb('payment confirmation (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let razorpay: FakeRazorpay;
    let server: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        const { consultPatientRoutes } = await import('./consultations.routes');
        server = await serve('/consult', consultPatientRoutes);
    });
    afterAll(async () => {
        await server?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    async function booked(key = 'key-pay-12345') {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, 24 * 60);
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: key }, { razorpay });
        return { doctor, user, patient, slot, res, orderId: res.razorpayOrderId!, fee: res.amountPaise };
    }
    const fact = (b: { orderId: string; fee: number }, paymentId = 'pay_test000001', patch: Partial<{ amountPaise: number; currency: string }> = {}) => ({
        paymentId, orderId: b.orderId, amountPaise: b.fee, currency: 'INR', ...patch,
    });
    const refunds = () => testDb.consultationRefund.findMany();
    const status = async (id: string) => (await testDb.consultation.findUniqueOrThrow({ where: { id } })).status;
    const expire = async (b: { res: { consultationId: string } }) => {
        await testDb.consultation.update({ where: { id: b.res.consultationId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
        await testDb.$transaction((tx) => import('./consultations.transitions').then((m) => m.expireHold(tx, b.res.consultationId)));
    };

    describe('verify', () => {
        it('confirms a valid payment and keeps the slot', async () => {
            const b = await booked();
            razorpay.addPayment(b.orderId, { id: 'pay_test000001', amount: b.fee });
            const out = await payments.verifyAndConfirm(b.user.id, b.res.consultationId, {
                razorpay_order_id: b.orderId, razorpay_payment_id: 'pay_test000001', razorpay_signature: sign(b.orderId, 'pay_test000001'),
            }, { razorpay });
            expect(out).toEqual({ outcome: 'confirmed', status: 'CONFIRMED' });
            const c = await testDb.consultation.findUniqueOrThrow({ where: { id: b.res.consultationId } });
            expect(c.confirmingPaymentId).toBe('pay_test000001');
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: b.slot.id } })).status).toBe('BOOKED');
        });

        it('rejects a wrong signature, another user, a different body order and an incomplete payment', async () => {
            const b = await booked();
            razorpay.addPayment(b.orderId, { id: 'pay_test000001', amount: b.fee });
            const base = { razorpay_order_id: b.orderId, razorpay_payment_id: 'pay_test000001', razorpay_signature: sign(b.orderId, 'pay_test000001') };
            await expect(payments.verifyAndConfirm(b.user.id, b.res.consultationId, { ...base, razorpay_signature: 'a'.repeat(64) }, { razorpay })).rejects.toMatchObject({ status: 400 });
            const stranger = await makeUser();
            await expect(payments.verifyAndConfirm(stranger.id, b.res.consultationId, base, { razorpay })).rejects.toMatchObject({ status: 404 });
            await expect(payments.verifyAndConfirm(b.user.id, b.res.consultationId, { ...base, razorpay_order_id: 'order_other' }, { razorpay })).rejects.toMatchObject({ status: 400 });
            razorpay.payments.get(b.orderId)![0].status = 'failed';
            await expect(payments.verifyAndConfirm(b.user.id, b.res.consultationId, base, { razorpay })).rejects.toMatchObject({ status: 400 });
            expect(await status(b.res.consultationId)).toBe('PENDING_PAYMENT');
        });

        it('captures an authorized payment before confirming', async () => {
            const b = await booked();
            razorpay.addPayment(b.orderId, { id: 'pay_test000001', amount: b.fee, status: 'authorized' });
            const out = await payments.verifyAndConfirm(b.user.id, b.res.consultationId, {
                razorpay_payment_id: 'pay_test000001', razorpay_signature: sign(b.orderId, 'pay_test000001'),
            }, { razorpay });
            expect(out.status).toBe('CONFIRMED');
            expect(razorpay.captured).toEqual(['pay_test000001']);
        });

        it('says so when Razorpay cannot be reached', async () => {
            const b = await booked();
            razorpay.unreachable = true;
            await expect(payments.verifyAndConfirm(b.user.id, b.res.consultationId, {
                razorpay_payment_id: 'pay_test000001', razorpay_signature: sign(b.orderId, 'pay_test000001'),
            }, { razorpay })).rejects.toMatchObject({ status: 502 });
        });
    });

    describe('confirmPayment', () => {
        it('confirms once however many callers report the same payment at the same time', async () => {
            const b = await booked();
            const results = await Promise.all([1, 2, 3].map(() => payments.confirmPayment(fact(b))));
            expect(results.filter((r) => r === 'confirmed')).toHaveLength(1);
            expect(results.filter((r) => r === 'already')).toHaveLength(2);
            expect(await refunds()).toHaveLength(0);
            expect(await status(b.res.consultationId)).toBe('CONFIRMED');
        });

        it('reports a payment for an unknown order', async () => {
            expect(await payments.confirmPayment({ paymentId: 'pay_x', orderId: 'order_nope', amountPaise: 1, currency: 'INR' })).toBe('unknown_order');
        });

        it('re-claims a free slot for a late payment', async () => {
            const b = await booked();
            await expire(b);
            expect(await payments.confirmPayment(fact(b))).toBe('reclaimed');
            expect(await status(b.res.consultationId)).toBe('CONFIRMED');
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: b.slot.id } })).status).toBe('BOOKED');
        });

        it('refunds in full when the slot was taken by someone else', async () => {
            const b = await booked();
            await expire(b);
            const other = await makeUser();
            const otherPatient = await makePatient(other.id);
            await booking.createBooking({ userId: other.id, patientId: otherPatient.id, slotId: b.slot.id, idempotencyKey: 'key-other-1234' }, { razorpay });
            expect(await payments.confirmPayment(fact(b))).toBe('refund_created');
            expect(await status(b.res.consultationId)).toBe('EXPIRED');
            const [r] = await refunds();
            expect(r).toMatchObject({ reason: 'LATE_PAYMENT_SLOT_LOST', amountPaise: b.fee, status: 'PENDING' });
        });

        it('refunds in full when the doctor was suspended before the late payment', async () => {
            const b = await booked();
            await expire(b);
            await testDb.doctorProfile.update({ where: { id: b.doctor.profile.id }, data: { status: 'SUSPENDED' } });
            expect(await payments.confirmPayment(fact(b))).toBe('refund_created');
            expect((await refunds())[0].reason).toBe('LATE_PAYMENT_SLOT_LOST');
        });

        it('refunds in full when the patient cancelled before paying', async () => {
            const b = await booked();
            await testDb.$transaction(async (tx) => {
                await tx.consultation.update({ where: { id: b.res.consultationId }, data: { status: 'CANCELLED' } });
                await tx.slot.update({ where: { id: b.slot.id }, data: { status: 'AVAILABLE' } });
            });
            expect(await payments.confirmPayment(fact(b))).toBe('refund_created');
            expect((await refunds())[0]).toMatchObject({ reason: 'PAID_AFTER_CANCEL', amountPaise: b.fee });
        });

        it('refunds a second captured payment on a confirmed consultation', async () => {
            const b = await booked();
            await payments.confirmPayment(fact(b, 'pay_first00001'));
            expect(await payments.confirmPayment(fact(b, 'pay_second0002'))).toBe('refund_created');
            expect(await status(b.res.consultationId)).toBe('CONFIRMED');
            const rows = await refunds();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ reason: 'DUPLICATE_PAYMENT', amountPaise: b.fee });
            const second = await testDb.consultationPayment.findUniqueOrThrow({ where: { razorpayPaymentId: 'pay_second0002' } });
            expect(rows[0].paymentId).toBe(second.id);
        });

        it('confirms nothing and flags the booking when the amount does not match', async () => {
            const b = await booked();
            expect(await payments.confirmPayment(fact(b, 'pay_test000001', { amountPaise: b.fee - 100 }))).toBe('flagged');
            const c = await testDb.consultation.findUniqueOrThrow({ where: { id: b.res.consultationId } });
            expect(c.status).toBe('PENDING_PAYMENT');
            expect(c.reviewReason).toBe('amount_mismatch');
            expect(c.confirmingPaymentId).toBeNull();
        });

        it('gives two late payments for one freed slot a winner and a full refund', async () => {
            const a = await booked('key-late-aaaaaa');
            await expire(a);
            const doctorId = a.doctor.profile.id;
            const user2 = await makeUser();
            const patient2 = await makePatient(user2.id);
            // A second consultation on the same slot that also expired earlier.
            const second = await testDb.consultation.create({
                data: {
                    userId: user2.id, patientId: patient2.id, doctorId, slotId: a.slot.id, startsAt: a.slot.startsAt, status: 'EXPIRED',
                    feePaise: a.fee, platformFeePaise: 0, policyId: 'default-consult-policy-v1', policySnapshot: { minLeadMinutes: 15 },
                    holdExpiresAt: new Date(Date.now() - 1000), idempotencyKey: 'key-late-bbbbbb', requestHash: 'h', orderReceipt: 'rcpt_late_second',
                },
            });
            await testDb.consultationPayment.create({ data: { consultationId: second.id, razorpayOrderId: 'order_second', amountPaise: a.fee } });
            const results = await Promise.all([
                payments.confirmPayment(fact(a, 'pay_late00000a')),
                payments.confirmPayment({ paymentId: 'pay_late00000b', orderId: 'order_second', amountPaise: a.fee, currency: 'INR' }),
            ]);
            expect(results.sort()).toEqual(['reclaimed', 'refund_created']);
            const rows = await refunds();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ reason: 'LATE_PAYMENT_SLOT_LOST', amountPaise: a.fee });
        });

        it('ends in one consistent state when a cancel and a payment race', async () => {
            for (let i = 0; i < 5; i++) {
                const b = await booked(`key-race-${i}-12345`);
                const cancel = testDb.$transaction(async (tx) => {
                    const res = await tx.consultation.updateMany({ where: { id: b.res.consultationId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
                    if (res.count === 1) await tx.slot.updateMany({ where: { id: b.slot.id, status: 'BOOKED' }, data: { status: 'AVAILABLE' } });
                });
                await Promise.all([cancel, payments.confirmPayment(fact(b, `pay_race0000${i}`))]);
                const final = await status(b.res.consultationId);
                const rows = (await refunds()).filter((r) => r.consultationId === b.res.consultationId);
                if (final === 'CONFIRMED') expect(rows).toHaveLength(0);
                else {
                    expect(final).toBe('CANCELLED');
                    expect(rows).toHaveLength(1);
                    expect(rows[0].amountPaise).toBe(b.fee);
                }
            }
        });
    });

    describe('route', () => {
        it('rejects a cookie request with the mobile header and no CSRF token', async () => {
            const b = await booked();
            const res = await fetch(`${server.url}/consult/bookings/${b.res.consultationId}/verify`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', cookie: `docnow_access=${tokenFor(b.user as any)}`, 'x-client-type': 'mobile' },
                body: JSON.stringify({ razorpay_payment_id: 'pay_test000001', razorpay_signature: 'a'.repeat(64) }),
            });
            expect(res.status).toBe(403);
        });
        it('rejects a malformed payment id and signature', async () => {
            const b = await booked();
            const res = await fetch(`${server.url}/consult/bookings/${b.res.consultationId}/verify`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(b.user as any)}` },
                body: JSON.stringify({ razorpay_payment_id: 'x', razorpay_signature: 'y' }),
            });
            expect(res.status).toBe(400);
        });
    });
});
