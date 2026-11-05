import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from '../modules/consultations/test/db';
import { FakeRazorpay } from '../modules/consultations/test/fakeRazorpay';

describeDb('consultation repair job (real Postgres)', () => {
    let booking: typeof import('../modules/consultations/consultations.booking');
    let payments: typeof import('../modules/consultations/consultations.payments');
    let refunds: typeof import('../modules/consultations/consultations.refunds');
    let job: typeof import('./consultReconciler');
    let razorpay: FakeRazorpay;
    let alerts: string[];
    const alert = (name: string) => { alerts.push(name); };

    beforeAll(async () => {
        booking = await import('../modules/consultations/consultations.booking');
        payments = await import('../modules/consultations/consultations.payments');
        refunds = await import('../modules/consultations/consultations.refunds');
        job = await import('./consultReconciler');
    });
    afterAll(async () => testDb?.$disconnect());
    beforeEach(async () => {
        await resetConsultData();
        await testDb.webhookEventV2.deleteMany({ where: { source: 'razorpay_consult' } });
        razorpay = new FakeRazorpay();
        alerts = [];
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    let n = 0;
    async function booked() {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, 30 * 60);
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-job-${++n}-123456` }, { razorpay });
        return { doctor, user, slot, id: res.consultationId, orderId: res.razorpayOrderId!, fee: res.amountPaise };
    }
    const lapse = (id: string) => testDb.consultation.update({ where: { id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    const age = (table: string, id: string, minutes: number) =>
        testDb.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '${minutes} minutes' WHERE id = $1`, id);
    const ageCreated = (table: string, id: string, minutes: number) =>
        testDb.$executeRawUnsafe(`UPDATE "${table}" SET "createdAt" = (now() AT TIME ZONE 'UTC') - interval '${minutes} minutes' WHERE id = $1`, id);
    const status = async (id: string) => (await testDb.consultation.findUniqueOrThrow({ where: { id } })).status;
    const slotStatus = async (id: string) => (await testDb.slot.findUniqueOrThrow({ where: { id } })).status;
    const cycle = () => job.runConsultCycle({ razorpay, alert });

    it('expires a lapsed hold with no payment at Razorpay and frees the slot', async () => {
        const b = await booked();
        await lapse(b.id);
        await cycle();
        expect(await status(b.id)).toBe('EXPIRED');
        expect(await slotStatus(b.slot.id)).toBe('AVAILABLE');
    });

    it('confirms a lapsed hold whose payment was captured but never reported', async () => {
        const b = await booked();
        await lapse(b.id);
        razorpay.addPayment(b.orderId, { id: 'pay_job000000001', amount: b.fee });
        await cycle();
        expect(await status(b.id)).toBe('CONFIRMED');
        expect(await slotStatus(b.slot.id)).toBe('BOOKED');
    });

    it('leaves a hold that has not lapsed alone', async () => {
        const b = await booked();
        await cycle();
        expect(await status(b.id)).toBe('PENDING_PAYMENT');
    });

    it('catches a missed late payment on an expired hold and re-claims the slot', async () => {
        const b = await booked();
        await lapse(b.id);
        await cycle();
        expect(await status(b.id)).toBe('EXPIRED');
        const row = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: b.id } });
        await ageCreated('ConsultationPayment', row.id, 10);
        razorpay.addPayment(b.orderId, { id: 'pay_job000000002', amount: b.fee });
        await cycle();
        expect(await status(b.id)).toBe('CONFIRMED');
    });

    it('leaves the same end state when two runs overlap, with no duplicate refunds', async () => {
        const a = await booked();
        const c = await booked();
        await lapse(a.id);
        await lapse(c.id);
        razorpay.addPayment(a.orderId, { id: 'pay_job000000003', amount: a.fee });
        await Promise.all([cycle(), cycle()]);
        expect(await status(a.id)).toBe('CONFIRMED');
        expect(await status(c.id)).toBe('EXPIRED');
        expect(await testDb.consultationRefund.count()).toBe(0);
    });

    it('sends a pending refund that was never sent', async () => {
        const b = await booked();
        await payments.confirmPayment({ paymentId: 'pay_job000000004', orderId: b.orderId, amountPaise: b.fee, currency: 'INR' });
        const pay = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: b.id } });
        const r = await testDb.$transaction((tx) => refunds.createRefundRecord(tx, { consultationId: b.id, paymentId: pay.id, reason: 'ADMIN' }));
        await age('ConsultationRefund', r!.id, 5);
        await cycle();
        expect(razorpay.refunds).toHaveLength(1);
        expect((await testDb.consultationRefund.findUniqueOrThrow({ where: { id: r!.id } })).status).toBe('PROCESSED');
    });

    it('moves a pending refund that Razorpay shows as processed to refunded', async () => {
        const b = await booked();
        await payments.confirmPayment({ paymentId: 'pay_job000000005', orderId: b.orderId, amountPaise: b.fee, currency: 'INR' });
        const pay = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: b.id } });
        await testDb.$transaction(async (tx) => {
            await tx.consultation.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
            await tx.slot.update({ where: { id: b.slot.id }, data: { status: 'AVAILABLE' } });
        });
        const r = await testDb.consultationRefund.create({
            data: { consultationId: b.id, paymentId: pay.id, reason: 'PATIENT_CANCEL', amountPaise: b.fee, receipt: 'rf_job_1', razorpayRefundId: 'rfnd_77' },
        });
        razorpay.refunds.push({ id: 'rfnd_77', amount: b.fee, status: 'processed', receipt: 'rf_job_1', paymentId: 'pay_job000000005' });
        await age('ConsultationRefund', r.id, 5);
        await cycle();
        expect((await testDb.consultationRefund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('PROCESSED');
        expect(await status(b.id)).toBe('REFUNDED');
    });

    it('moves a pending refund that Razorpay shows as failed to failed', async () => {
        const b = await booked();
        await payments.confirmPayment({ paymentId: 'pay_job000000007', orderId: b.orderId, amountPaise: b.fee, currency: 'INR' });
        const pay = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: b.id } });
        const r = await testDb.consultationRefund.create({
            data: { consultationId: b.id, paymentId: pay.id, reason: 'ADMIN', amountPaise: b.fee, receipt: 'rf_job_fail', razorpayRefundId: 'rfnd_88' },
        });
        razorpay.refunds.push({ id: 'rfnd_88', amount: b.fee, status: 'failed', receipt: 'rf_job_fail', paymentId: 'pay_job000000007' });
        await age('ConsultationRefund', r.id, 5);
        await cycle();
        expect(await testDb.consultationRefund.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'FAILED', failureConfirmed: true });
    });

    it('re-checks an old abandoned order only hourly, and a fresh one every cycle', async () => {
        const b = await booked();
        await lapse(b.id);
        await cycle();
        const row = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: b.id } });
        await ageCreated('ConsultationPayment', row.id, 4 * 60);
        await age('ConsultationPayment', row.id, 4 * 60);
        razorpay.orderLookups = 0;
        await cycle();
        expect(razorpay.orderLookups).toBe(1);
        await cycle();
        expect(razorpay.orderLookups).toBe(1);
        await age('ConsultationPayment', row.id, 90);
        await cycle();
        expect(razorpay.orderLookups).toBe(2);
    });

    it('does not let one bad row stop the batch', async () => {
        const bad = await booked();
        const good = await booked();
        await lapse(bad.id);
        await lapse(good.id);
        razorpay.failOrderLookups.add(bad.orderId);
        await cycle();
        expect(await status(bad.id)).toBe('PENDING_PAYMENT');
        expect(await status(good.id)).toBe('EXPIRED');
    });

    it('raises an alert for webhook events left unprocessed and for payments awaiting staff', async () => {
        const row = await testDb.webhookEventV2.create({ data: { payloadHash: 'consult:evt_job_stuck', source: 'razorpay_consult', eventType: 'payment.captured', processed: false } });
        await testDb.$executeRawUnsafe(`UPDATE "WebhookEventV2" SET "createdAt" = (now() AT TIME ZONE 'UTC') - interval '30 minutes' WHERE id = $1`, row.id);
        const b = await booked();
        await testDb.consultation.update({ where: { id: b.id }, data: { reviewReason: 'amount_mismatch' } });
        await age('Consultation', b.id, 120);
        await cycle();
        expect(alerts).toContain('consult_webhook_events_unprocessed');
        expect(alerts).toContain('consult_payments_awaiting_staff');
    });

    it('repairs an order made at Razorpay whose id was never stored, without creating a second', async () => {
        const b = await booked();
        await testDb.consultationPayment.deleteMany({ where: { consultationId: b.id } });
        await ageCreated('Consultation', b.id, 10);
        await lapse(b.id);
        await cycle();
        expect(razorpay.orders).toHaveLength(1);
        expect(await testDb.consultationPayment.count({ where: { consultationId: b.id } })).toBe(1);
        expect(await status(b.id)).toBe('EXPIRED');
    });

    it('confirms a booking whose order id was never stored when the patient had paid', async () => {
        const b = await booked();
        await testDb.consultationPayment.deleteMany({ where: { consultationId: b.id } });
        await ageCreated('Consultation', b.id, 10);
        await lapse(b.id);
        razorpay.addPayment(b.orderId, { id: 'pay_job000000006', amount: b.fee });
        await cycle();
        expect(await status(b.id)).toBe('CONFIRMED');
    });

    it('changes nothing and raises one alert when Razorpay is unreachable', async () => {
        const b = await booked();
        await lapse(b.id);
        razorpay.unreachable = true;
        await cycle();
        expect(await status(b.id)).toBe('PENDING_PAYMENT');
        expect(alerts.filter((a) => a === 'consult_reconciler_razorpay_unreachable')).toHaveLength(1);
    });
});
