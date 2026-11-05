import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from './consultations.policy';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('consultation read routes (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let cancel: typeof import('./consultations.cancellation');
    let policy: typeof import('./consultations.policy.service');
    let doctors: typeof import('./doctors.service');
    let razorpay: FakeRazorpay;
    let patientApp: { url: string; close: () => Promise<void> };
    let publicApp: { url: string; close: () => Promise<void> };
    let doctorApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        cancel = await import('./consultations.cancellation');
        policy = await import('./consultations.policy.service');
        doctors = await import('./doctors.service');
        const routes = await import('./doctors.routes');
        const patientRoutes = await import('./consultations.routes');
        patientApp = await serve('/consult', patientRoutes.consultPatientRoutes);
        publicApp = await serve('/consult', routes.consultPublicRoutes);
        doctorApp = await serve('/doctor', routes.doctorRoutes);
    });
    afterAll(async () => {
        await Promise.all([patientApp?.close(), publicApp?.close(), doctorApp?.close()]);
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    let n = 0;
    async function booked(hoursAhead = 30, user?: { id: string }) {
        const doctor = await makeDoctor();
        const owner = user ?? (await makeUser());
        const patient = await makePatient(owner.id);
        const slot = await makeSlot(doctor.profile.id, Math.round(hoursAhead * 60));
        const res = await booking.createBooking({ userId: owner.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-reads-${++n}-1234` }, { razorpay });
        return { doctor, user: owner, patient, slot, res, orderId: res.razorpayOrderId!, fee: res.amountPaise };
    }
    const pay = (b: { orderId: string; fee: number }, id: string) =>
        payments.confirmPayment({ paymentId: id, orderId: b.orderId, amountPaise: b.fee, currency: 'INR' });
    const get = (url: string, token?: string) => fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });

    describe('bookings list and detail', () => {
        it('lists only the caller\'s bookings, newest first, with names', async () => {
            const user = await makeUser();
            const first = await booked(30, user);
            const second = await booked(40, user);
            await booked(30);
            const list = await booking.listBookings(user.id);
            expect(list.map((b) => b.consultationId)).toEqual([second.res.consultationId, first.res.consultationId]);
            expect(list[0]).toMatchObject({ doctorName: 'Dr Test', specialty: 'Test Specialty', patientName: 'Test Patient', status: 'PENDING_PAYMENT' });
        });

        it('serves the list through the route and keeps it private to the caller', async () => {
            const b = await booked();
            const stranger = await makeUser();
            const mine = await get(`${patientApp.url}/consult/bookings`, tokenFor(b.user as any));
            expect((await mine.json()).map((x: any) => x.consultationId)).toEqual([b.res.consultationId]);
            expect(await (await get(`${patientApp.url}/consult/bookings`, tokenFor(stranger as any))).json()).toEqual([]);
            expect((await get(`${patientApp.url}/consult/bookings`)).status).toBe(401);
        });

        it('returns names, end time, payment and refund state in the detail, and not found for others', async () => {
            const b = await booked();
            await pay(b, 'pay_reads0000001');
            const detail = await booking.getBooking(b.user.id, b.res.consultationId);
            expect(detail).toMatchObject({ doctorName: 'Dr Test', patientName: 'Test Patient', paymentCaptured: true, underStaffCheck: false, refundPaise: 0, refundStatus: null });
            expect(new Date(detail.endsAt).getTime()).toBe(b.slot.endsAt.getTime());
            const stranger = await makeUser();
            await expect(booking.getBooking(stranger.id, b.res.consultationId)).rejects.toMatchObject({ status: 404 });
        });

        it('reports refund state after a cancel and staff checking for a flagged booking', async () => {
            const b = await booked();
            await pay(b, 'pay_reads0000002');
            await cancel.cancelConsultation(b.res.consultationId, { kind: 'booker', userId: b.user.id }, undefined, { razorpay });
            const after = await booking.getBooking(b.user.id, b.res.consultationId);
            expect(after.refundPaise).toBe(b.fee);
            expect(after.refundStatus).toBe('PROCESSED');
            const f = await booked();
            await payments.confirmPayment({ paymentId: 'pay_reads0000003', orderId: f.orderId, amountPaise: f.fee - 100, currency: 'INR' });
            expect((await booking.getBooking(f.user.id, f.res.consultationId)).underStaffCheck).toBe(true);
        });
    });

    describe('cancel preview', () => {
        it('matches what cancel then refunds at 30, 10 and 2 hours', async () => {
            for (const hours of [30, 10, 2]) {
                const b = await booked(hours);
                await pay(b, `pay_prev${String(++n).padStart(8, '0')}`);
                const preview = await cancel.cancelPreview(b.user.id, b.res.consultationId);
                const result = await cancel.cancelConsultation(b.res.consultationId, { kind: 'booker', userId: b.user.id }, undefined, { razorpay });
                expect(result.refundPaise).toBe(preview.refundPaise);
            }
        });

        it('keeps the preview on the rules copied at booking after rules are edited', async () => {
            const b = await booked(30);
            await pay(b, 'pay_reads0000004');
            const admin = await makeUser('SUPER_ADMIN');
            await policy.updatePolicy({ rules: { ...DEFAULT_RULES, refundTiers: [{ minHoursBefore: 24, percent: 0 }, { minHoursBefore: 0, percent: 0 }] }, reason: 'strict', adminId: admin.id, adminName: 'A', ip: '1.1.1.1' });
            expect((await cancel.cancelPreview(b.user.id, b.res.consultationId)).refundPaise).toBe(b.fee);
        });

        it('says an unpaid booking cancels with no refund and refuses one that cannot be cancelled', async () => {
            const b = await booked(30);
            expect(await cancel.cancelPreview(b.user.id, b.res.consultationId)).toMatchObject({ refundPaise: 0 });
            await testDb.consultation.update({ where: { id: b.res.consultationId }, data: { status: 'IN_PROGRESS' } });
            await expect(cancel.cancelPreview(b.user.id, b.res.consultationId)).rejects.toMatchObject({ status: 409 });
            const stranger = await makeUser();
            await expect(cancel.cancelPreview(stranger.id, b.res.consultationId)).rejects.toMatchObject({ status: 404 });
        });

        it('is served by the route', async () => {
            const b = await booked(30);
            await pay(b, 'pay_reads0000005');
            const res = await get(`${patientApp.url}/consult/bookings/${b.res.consultationId}/cancel-preview`, tokenFor(b.user as any));
            expect(res.status).toBe(200);
            expect((await res.json()).refundPaise).toBe(b.fee);
        });
    });

    describe('doctor resubmit', () => {
        const base = { displayName: 'Dr Fixed', qualification: 'MBBS, MD', registrationCouncil: 'Fix Council', experienceYears: 5, languages: ['English'] };
        // Doctor rows persist between tests, so each use gets its own registration number.
        const fresh = () => ({ ...base, registrationNumber: `FIX-${Math.random().toString(36).slice(2, 10)}` });
        async function applicant(status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED') {
            const d = await makeDoctor({ status: status as any });
            await testDb.user.update({ where: { id: d.user.id }, data: { role: 'USER' } });
            if (status === 'REJECTED') await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { statusReason: 'bad photo' } });
            return d;
        }

        it('lets a rejected doctor fix the application and returns it to pending', async () => {
            const d = await applicant('REJECTED');
            const specialty = d.profile.specialtyId;
            const updated = await doctors.resubmitDoctor(d.user.id, { ...fresh(), specialtyId: specialty });
            expect(updated).toMatchObject({ status: 'PENDING', statusReason: null, displayName: 'Dr Fixed' });
        });

        it('refuses pending, approved and suspended applications and users with none', async () => {
            for (const status of ['PENDING', 'APPROVED', 'SUSPENDED'] as const) {
                const d = await applicant(status);
                await expect(doctors.resubmitDoctor(d.user.id, { ...fresh(), specialtyId: d.profile.specialtyId })).rejects.toMatchObject({ status: 409 });
            }
            const nobody = await makeUser();
            const d = await applicant('REJECTED');
            await expect(doctors.resubmitDoctor(nobody.id, { ...fresh(), specialtyId: d.profile.specialtyId })).rejects.toMatchObject({ status: 404 });
        });

        it('is served by the route with validation and no token rejected', async () => {
            const d = await applicant('REJECTED');
            const post = (token: string | null, body: unknown) => fetch(`${doctorApp.url}/doctor/resubmit`, {
                method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
            });
            expect((await post(null, {})).status).toBe(401);
            expect((await post(tokenFor(d.user as any), { ...fresh(), specialtyId: d.profile.specialtyId, languages: [] })).status).toBe(400);
            expect((await post(tokenFor(d.user as any), { ...fresh(), specialtyId: d.profile.specialtyId })).status).toBe(200);
        });
    });

    describe('public slots', () => {
        it('hides a slot starting inside the lead time and keeps later ones', async () => {
            const d = await makeDoctor();
            const soon = await makeSlot(d.profile.id, 10);
            const later = await makeSlot(d.profile.id, 24 * 60);
            const res = await get(`${publicApp.url}/consult/doctors/${d.profile.id}/slots`);
            const ids = (await res.json()).map((s: any) => s.id);
            expect(ids).toContain(later.id);
            expect(ids).not.toContain(soon.id);
        });
    });
});
