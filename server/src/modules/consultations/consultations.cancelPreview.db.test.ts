import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { DEFAULT_RULES } from './consultations.policy';
import { describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('the cancel box: what the customer is told before cancelling (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let cancel: typeof import('./consultations.cancellation');
    let policy: typeof import('./consultations.policy.service');
    let patientApp: { url: string; close: () => Promise<void> };
    let razorpay: FakeRazorpay;

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        cancel = await import('./consultations.cancellation');
        policy = await import('./consultations.policy.service');
        patientApp = await serve('/consult', (await import('./consultations.routes')).consultPatientRoutes);
    });

    afterAll(async () => {
        await patientApp?.close();
        await testDb?.$disconnect();
    });

    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });

    let n = 0;
    async function paid(hoursAhead: number) {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, Math.round(hoursAhead * 60));
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `prev-${++n}-12345678` }, { razorpay });
        await payments.confirmPayment({ paymentId: `pay_prev${String(n).padStart(7, '0')}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
        return { user, slot, id: res.consultationId, fee: res.amountPaise };
    }

    async function unpaid() {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, 30 * 60);
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `prev-u-${++n}-12345678` }, { razorpay });
        return { user, id: res.consultationId };
    }

    const preview = (user: { id: string; tokenVersion: number }, id: string) =>
        cancel.cancelPreview(user.id, id);
    const previewOverHttp = async (user: { id: string; tokenVersion: number }, id: string) => {
        const res = await fetch(`${patientApp.url}/consult/bookings/${id}/cancel-preview`, { headers: { authorization: `Bearer ${tokenFor(user as any)}` } });
        return { status: res.status, body: await res.json() };
    };

    it('shows the full-refund tier more than a day ahead', async () => {
        const c = await paid(30);
        expect(await preview(c.user as any, c.id)).toMatchObject({ percent: 100, refundPaise: c.fee, paidPaise: c.fee });
    });

    it('shows the half tier between six and twenty-four hours, and nothing inside six', async () => {
        const mid = await paid(10);
        expect(await preview(mid.user as any, mid.id)).toMatchObject({ percent: 50, refundPaise: Math.floor((mid.fee * 50 + 50) / 100) });

        const late = await paid(2);
        expect(await preview(late.user as any, late.id)).toMatchObject({ percent: 0, refundPaise: 0, paidPaise: late.fee });
    });

    it('carries the rules the booking was held to, not the ones in force now', async () => {
        const c = await paid(30);
        const admin = await makeUser('SUPER_ADMIN');
        await policy.updatePolicy({
            rules: { ...DEFAULT_RULES, refundTiers: [{ minHoursBefore: 48, percent: 10 }, { minHoursBefore: 0, percent: 0 }] },
            reason: 'strict', adminId: admin.id, adminName: 'A', ip: '1.1.1.1',
        });

        const out = await preview(c.user as any, c.id);
        expect(out.policy!.refundTiers).toEqual(DEFAULT_RULES.refundTiers);
        expect(out.percent).toBe(100);
    });

    it('says the doctor no-show gives the whole fee back', async () => {
        const c = await paid(30);
        expect((await preview(c.user as any, c.id)).policy!.doctorNoShowFullRefund).toBe(true);
    });

    it('offers nothing and no tiers for a booking that was never paid', async () => {
        const c = await unpaid();
        expect(await preview(c.user as any, c.id)).toEqual({ percent: 0, refundPaise: 0, walletRefundPaise: 0, paidPaise: 0, walletPaidPaise: 0 });
    });

    it('refuses a preview once the consultation can no longer be cancelled', async () => {
        const c = await paid(30);
        await testDb.consultation.update({ where: { id: c.id }, data: { status: 'COMPLETED' } });
        await expect(preview(c.user as any, c.id)).rejects.toMatchObject({ status: 409 });
    });

    it('is served over HTTP to the booker only', async () => {
        const c = await paid(30);
        const mine = await previewOverHttp(c.user as any, c.id);
        expect(mine.status).toBe(200);
        expect(mine.body.policy.refundTiers).toEqual(DEFAULT_RULES.refundTiers);

        const stranger = await makeUser();
        expect((await previewOverHttp(stranger as any, c.id)).status).toBe(404);
        expect((await previewOverHttp(c.user as any, 'not-a-uuid')).status).toBe(404);
    });
});
