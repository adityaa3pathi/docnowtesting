import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from './consultations.policy';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';
import { RazorpayError } from './consultations.razorpay';

useTestJwtSecret();

describeDb('cancellation and refunds (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let cancel: typeof import('./consultations.cancellation');
    let refunds: typeof import('./consultations.refunds');
    let policy: typeof import('./consultations.policy.service');
    let razorpay: FakeRazorpay;
    let patientApp: { url: string; close: () => Promise<void> };
    let adminApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        cancel = await import('./consultations.cancellation');
        refunds = await import('./consultations.refunds');
        policy = await import('./consultations.policy.service');
        patientApp = await serve('/consult', (await import('./consultations.routes')).consultPatientRoutes);
        adminApp = await serve('/admin', (await import('./doctors.routes')).consultAdminRoutes);
    });
    afterAll(async () => {
        await patientApp?.close();
        await adminApp?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        await testDb.adminAuditLog.deleteMany({ where: { entity: { in: ['Consultation', 'ConsultationRefund'] } } });
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    let n = 0;
    async function paid(hoursAhead = 30) {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, Math.round(hoursAhead * 60));
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-cancel-${++n}-12345` }, { razorpay });
        await payments.confirmPayment({ paymentId: `pay_cancel${String(n).padStart(6, '0')}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
        return { doctor, user, patient, slot, id: res.consultationId, fee: res.amountPaise };
    }
    const doCancel = (c: { id: string; user: { id: string } }, now?: Date, reason?: string) =>
        cancel.cancelConsultation(c.id, { kind: 'booker', userId: c.user.id }, reason, { razorpay, now: now ? () => now : undefined });
    const status = async (id: string) => (await testDb.consultation.findUniqueOrThrow({ where: { id } })).status;
    const refundRows = () => testDb.consultationRefund.findMany();

    describe('tiers', () => {
        it('refunds in full 30 hours before, half at 10 hours, nothing at 2 hours', async () => {
            const a = await paid(30);
            expect(await doCancel(a)).toMatchObject({ status: 'REFUNDED', refundPaise: a.fee, refundStatus: 'PROCESSED' });
            const b = await paid(10);
            expect(await doCancel(b)).toMatchObject({ status: 'REFUNDED', refundPaise: Math.floor((b.fee * 50 + 50) / 100) });
            const calls = razorpay.refundCalls;
            const c = await paid(2);
            expect(await doCancel(c)).toMatchObject({ status: 'CANCELLED', refundPaise: 0 });
            expect(razorpay.refundCalls).toBe(calls);
            expect((await refundRows()).filter((r) => r.consultationId === c.id)).toHaveLength(0);
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: c.slot.id } })).status).toBe('AVAILABLE');
        });

        it('measures the tier at the server clock and ignores rules edited after booking', async () => {
            const c = await paid(30);
            const admin = await makeUser('SUPER_ADMIN');
            await policy.updatePolicy({
                rules: { ...DEFAULT_RULES, refundTiers: [{ minHoursBefore: 24, percent: 0 }, { minHoursBefore: 0, percent: 0 }] },
                reason: 'strict', adminId: admin.id, adminName: 'A', ip: '1.1.1.1',
            });
            const eightHoursBefore = new Date(c.slot.startsAt.getTime() - 8 * 3_600_000);
            const out = await doCancel(c, eightHoursBefore);
            expect(out.refundPaise).toBe(Math.floor((c.fee * 50 + 50) / 100));
        });

        it('creates one refund record when cancelled twice at the same time', async () => {
            const c = await paid(30);
            const [a, b] = await Promise.all([doCancel(c), doCancel(c)]);
            expect(['CANCELLED', 'REFUNDED']).toContain(a.status);
            expect(['CANCELLED', 'REFUNDED']).toContain(b.status);
            expect(await refundRows()).toHaveLength(1);
            expect(razorpay.refunds).toHaveLength(1);
        });

        it('frees the slot with no Razorpay call when cancelled before paying', async () => {
            const doctor = await makeDoctor();
            const user = await makeUser();
            const patient = await makePatient(user.id);
            const slot = await makeSlot(doctor.profile.id, 30 * 60);
            const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: 'key-unpaid-123' }, { razorpay });
            const out = await doCancel({ id: res.consultationId, user });
            expect(out).toMatchObject({ status: 'CANCELLED', refundPaise: 0 });
            expect(razorpay.refundCalls).toBe(0);
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('AVAILABLE');
        });

        it('lets only the booker cancel, and returns not found for anyone else', async () => {
            const c = await paid(30);
            const stranger = await makeUser();
            await expect(cancel.cancelConsultation(c.id, { kind: 'booker', userId: stranger.id }, undefined, { razorpay })).rejects.toMatchObject({ status: 404 });
            await expect(cancel.cancelConsultation(c.id, { kind: 'booker', userId: c.doctor.user.id }, undefined, { razorpay })).rejects.toMatchObject({ status: 404 });
        });

        it('rejects an over-long or non-text reason', async () => {
            const c = await paid(30);
            await expect(doCancel(c, undefined, 'x'.repeat(201))).rejects.toMatchObject({ status: 400 });
            await expect(doCancel(c, undefined, 'bad\u0007reason')).rejects.toMatchObject({ status: 400 });
            expect(await status(c.id)).toBe('CONFIRMED');
        });

        it('ends in one consistent state when a cancel races the payment', async () => {
            for (let i = 0; i < 4; i++) {
                const doctor = await makeDoctor();
                const user = await makeUser();
                const patient = await makePatient(user.id);
                const slot = await makeSlot(doctor.profile.id, 30 * 60 + i);
                const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-race-c${i}-123` }, { razorpay });
                await Promise.all([
                    doCancel({ id: res.consultationId, user }),
                    payments.confirmPayment({ paymentId: `pay_racecan0000${i}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' }),
                ]);
                const final = await status(res.consultationId);
                const rows = (await refundRows()).filter((r) => r.consultationId === res.consultationId);
                if (final === 'CONFIRMED') expect(rows).toHaveLength(0);
                else {
                    expect(['CANCELLED', 'REFUNDED']).toContain(final);
                    expect(rows).toHaveLength(1);
                    expect(rows[0].amountPaise).toBe(res.amountPaise);
                }
            }
        });
    });

    describe('refund runner', () => {
        async function pending(amountPercent = 100) {
            const c = await paid(30);
            const pay = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: c.id } });
            const record = await testDb.$transaction((tx) => refunds.createRefundRecord(tx, {
                consultationId: c.id, paymentId: pay.id, reason: 'ADMIN', requestedPaise: Math.floor((c.fee * amountPercent) / 100),
            }));
            return { c, pay, record: record! };
        }

        it('never lets refunds on one payment add up to more than was captured', async () => {
            const c = await paid(30);
            const pay = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: c.id } });
            const make = (reason: 'PATIENT_CANCEL' | 'DUPLICATE_PAYMENT', requestedPaise?: number) =>
                testDb.$transaction((tx) => refunds.createRefundRecord(tx, { consultationId: c.id, paymentId: pay.id, reason, requestedPaise }));
            await Promise.all([make('PATIENT_CANCEL', Math.floor(c.fee * 0.6)), make('DUPLICATE_PAYMENT')]);
            const total = (await refundRows()).reduce((s, r) => s + r.amountPaise, 0);
            expect(total).toBe(c.fee);
        });

        it('finds the refund a timed-out attempt made instead of creating a second', async () => {
            const { record } = await pending();
            razorpay.refundScript = ['timeout'];
            razorpay.unreachable = false;
            const first = await refunds.runRefund(record.id, { razorpay });
            expect(first).toBe('processed');
            expect(razorpay.refunds).toHaveLength(1);
            expect(razorpay.refundCalls).toBe(1);
        });

        it('lists first on the retry when the first listing could not be reached', async () => {
            const { record } = await pending();
            razorpay.refundScript = ['timeout'];
            const realList = razorpay.listPaymentRefunds.bind(razorpay);
            let blocked = true;
            razorpay.listPaymentRefunds = async (id: string) => { if (blocked) throw new RazorpayError('network', 'down'); return realList(id); };
            expect(await refunds.runRefund(record.id, { razorpay })).toBe('pending');
            blocked = false;
            expect(await refunds.runRefund(record.id, { razorpay })).toBe('processed');
            expect(razorpay.refundCalls).toBe(1);
            expect(razorpay.refunds).toHaveLength(1);
        });

        it('marks the refund failed after five server errors but keeps its amount reserved', async () => {
            const { c, pay, record } = await pending();
            razorpay.refundScript = Array.from({ length: 5 }, () => new RazorpayError('api', 'server error', 500));
            const outcomes: string[] = [];
            for (let i = 0; i < 5; i++) outcomes.push(await refunds.runRefund(record.id, { razorpay }));
            expect(outcomes.slice(0, 4)).toEqual(['pending', 'pending', 'pending', 'pending']);
            expect(outcomes[4]).toBe('failed');
            const row = await testDb.consultationRefund.findUniqueOrThrow({ where: { id: record.id } });
            expect(row).toMatchObject({ status: 'FAILED', failureConfirmed: false });
            expect(await status(c.id)).toBe('CONFIRMED');
            const another = await testDb.$transaction((tx) => refunds.createRefundRecord(tx, { consultationId: c.id, paymentId: pay.id, reason: 'DUPLICATE_PAYMENT' }));
            expect(another).toBeNull();
        });

        it('fails cleanly and frees the amount when Razorpay refuses the refund', async () => {
            const { c, pay, record } = await pending();
            razorpay.refundScript = [new RazorpayError('api', 'payment is older than 6 months', 400)];
            expect(await refunds.runRefund(record.id, { razorpay })).toBe('failed');
            const row = await testDb.consultationRefund.findUniqueOrThrow({ where: { id: record.id } });
            expect(row).toMatchObject({ status: 'FAILED', failureConfirmed: true });
            const another = await testDb.$transaction((tx) => refunds.createRefundRecord(tx, { consultationId: c.id, paymentId: pay.id, reason: 'DUPLICATE_PAYMENT' }));
            expect(another?.amountPaise).toBe(c.fee);
        });

        it('does not send the same refund twice when two runners start at once', async () => {
            const { record } = await pending();
            const results = await Promise.all([refunds.runRefund(record.id, { razorpay }), refunds.runRefund(record.id, { razorpay })]);
            expect(results.filter((r) => r === 'skipped')).toHaveLength(1);
            expect(razorpay.refunds).toHaveLength(1);
        });
    });

    describe('staff routes', () => {
        const call = (token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
            fetch(`${adminApp.url}/admin${path}`, {
                method,
                headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
                body: body === undefined ? undefined : JSON.stringify(body),
            });

        it('lists flagged payments and refunds that need staff, to super admins only', async () => {
            const admin = await makeUser('SUPER_ADMIN');
            const user = await makeUser();
            const c = await paid(30);
            await testDb.consultation.update({ where: { id: c.id }, data: { status: 'PENDING_PAYMENT', reviewReason: 'amount_mismatch' } });
            await testDb.slot.update({ where: { id: c.slot.id }, data: { status: 'BOOKED' } });
            const pay = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: c.id } });
            await testDb.consultationRefund.create({ data: { consultationId: c.id, paymentId: pay.id, reason: 'ADMIN', amountPaise: 100, status: 'FAILED', receipt: 'rf_list_1' } });
            const res = await call(tokenFor(admin), 'GET', '/review');
            const body = await res.json();
            expect(body.flaggedPayments.map((x: any) => x.id)).toEqual([c.id]);
            expect(body.refundsNeedingStaff).toHaveLength(1);
            expect((await call(tokenFor(user), 'GET', '/review')).status).toBe(403);
            await testDb.consultation.update({ where: { id: c.id }, data: { status: 'CONFIRMED', reviewReason: null } });
        });

        it('resolves a flagged payment by confirming it, with an audit entry, and requires a reason', async () => {
            const admin = await makeUser('SUPER_ADMIN');
            const doctor = await makeDoctor();
            const user = await makeUser();
            const patient = await makePatient(user.id);
            const slot = await makeSlot(doctor.profile.id, 30 * 60);
            const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: 'key-flag-123456' }, { razorpay });
            await payments.confirmPayment({ paymentId: 'pay_flagged0001', orderId: res.razorpayOrderId!, amountPaise: res.amountPaise - 100, currency: 'INR' });
            expect(await status(res.consultationId)).toBe('PENDING_PAYMENT');
            expect((await call(tokenFor(admin), 'POST', `/review/consultations/${res.consultationId}/resolve`, { action: 'confirm', reason: '' })).status).toBe(400);
            const ok = await call(tokenFor(admin), 'POST', `/review/consultations/${res.consultationId}/resolve`, { action: 'confirm', reason: 'customer paid the discounted amount' });
            expect(ok.status).toBe(200);
            expect(await status(res.consultationId)).toBe('CONFIRMED');
            const log = await testDb.adminAuditLog.findFirstOrThrow({ where: { action: 'CONSULT_PAYMENT_RESOLVE' } });
            expect(log).toMatchObject({ adminId: admin.id, entity: 'Consultation', targetId: res.consultationId });
            expect((log.newValue as any).reason).toContain('discounted');
        });

        it('resolves a flagged payment by refunding it', async () => {
            const admin = await makeUser('SUPER_ADMIN');
            const doctor = await makeDoctor();
            const user = await makeUser();
            const patient = await makePatient(user.id);
            const slot = await makeSlot(doctor.profile.id, 30 * 60);
            const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: 'key-flag-654321' }, { razorpay });
            await payments.confirmPayment({ paymentId: 'pay_flagged0002', orderId: res.razorpayOrderId!, amountPaise: res.amountPaise - 100, currency: 'INR' });
            await call(tokenFor(admin), 'POST', `/review/consultations/${res.consultationId}/resolve`, { action: 'refund', reason: 'wrong amount paid' });
            const rows = await refundRows();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ reason: 'ADMIN', amountPaise: res.amountPaise - 100 });
            expect((await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } })).reviewReason).toBeNull();
        });

        it('reopens a failed refund for a retry and records who did it', async () => {
            const admin = await makeUser('SUPER_ADMIN');
            const c = await paid(30);
            const pay = await testDb.consultationPayment.findFirstOrThrow({ where: { consultationId: c.id } });
            const r = await testDb.consultationRefund.create({ data: { consultationId: c.id, paymentId: pay.id, reason: 'ADMIN', amountPaise: 1000, status: 'FAILED', attempts: 5, receipt: 'rf_retry_1' } });
            const res = await call(tokenFor(admin), 'POST', `/review/refunds/${r.id}/retry`, { reason: 'bank issue fixed' });
            expect(res.status).toBe(200);
            const after = await testDb.consultationRefund.findUniqueOrThrow({ where: { id: r.id } });
            expect(after.status).toBe('PENDING');
            expect((await testDb.adminAuditLog.findFirstOrThrow({ where: { action: 'CONSULT_REFUND_RETRY' } })).adminId).toBe(admin.id);
            const again = await call(tokenFor(admin), 'POST', `/review/refunds/${r.id}/retry`, { reason: 'again' });
            expect(again.status).toBe(409);
        });

        it('cancels on a patient\'s behalf through the admin route with the actor recorded', async () => {
            const admin = await makeUser('SUPER_ADMIN');
            const c = await paid(2);
            const res = await call(tokenFor(admin), 'POST', `/consultations/${c.id}/cancel`, { reason: 'doctor unavailable' });
            expect(res.status).toBe(200);
            const row = await testDb.consultation.findUniqueOrThrow({ where: { id: c.id } });
            expect(row.cancelledBy).toBe(`admin:${admin.id}`);
            expect((await call(tokenFor(c.user as any), 'POST', `/consultations/${c.id}/cancel`, { reason: 'x yz' })).status).toBe(403);
        });

        it('rejects a cookie request with the mobile header and no CSRF token on staff and patient cancel routes', async () => {
            const admin = await makeUser('SUPER_ADMIN');
            const c = await paid(30);
            const cookieHeaders = (u: any) => ({ cookie: `docnow_access=${tokenFor(u)}`, 'x-client-type': 'mobile' });
            expect((await call(null, 'POST', `/consultations/${c.id}/cancel`, { reason: 'abc' }, cookieHeaders(admin))).status).toBe(403);
            const patientCancel = await fetch(`${patientApp.url}/consult/bookings/${c.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json', ...cookieHeaders(c.user) }, body: '{}' });
            expect(patientCancel.status).toBe(403);
            expect(await status(c.id)).toBe('CONFIRMED');
        });
    });
});
