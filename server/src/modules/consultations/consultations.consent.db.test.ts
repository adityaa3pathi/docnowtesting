import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('telemedicine consent given at sign-up (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let room: typeof import('./consultations.room');
    let patientApp: { url: string; close: () => Promise<void> };
    let authApp: { url: string; close: () => Promise<void> };
    let razorpay: FakeRazorpay;

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        room = await import('./consultations.room');
        patientApp = await serve('/consult', (await import('./consultations.routes')).consultPatientRoutes);
        authApp = await serve('/auth', (await import('../../routes/auth')).default);
    });

    afterAll(async () => {
        await patientApp?.close();
        await authApp?.close();
        await testDb?.$disconnect();
    });

    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });

    let n = 0;
    async function paidBooking(user: { id: string }, patientOwner = user.id) {
        const doctor = await makeDoctor();
        const patient = await makePatient(patientOwner);
        const slot = await makeSlot(doctor.profile.id, 30 * 60);
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `consent-${++n}-12345678` }, { razorpay });
        await payments.confirmPayment({ paymentId: `pay_consent${String(n).padStart(6, '0')}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
        return { doctor, patient, slot, id: res.consultationId };
    }

    const consentedUser = async () => {
        const user = await makeUser();
        return testDb.user.update({ where: { id: user.id }, data: { telemedicineConsentAt: new Date(), telemedicineConsentVersion: room.CONSENT_VERSION } });
    };

    describe('what the sign-up tick records', () => {
        async function signUp(body: Record<string, unknown>) {
            const mobile = `73${String(++n).padStart(8, '0')}`;
            await testDb.oTP.upsert({
                where: { identifier: mobile },
                update: { code: '123456', expiresAt: new Date(Date.now() + 600_000) },
                create: { identifier: mobile, code: '123456', expiresAt: new Date(Date.now() + 600_000) },
            });
            const res = await fetch(`${authApp.url}/auth/signup/verify`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mobile, code: '123456', password: 'Str0ngPass!', age: 30, name: 'Asha Sharma', gender: 'Female', ...body }),
            });
            return { status: res.status, user: await testDb.user.findUnique({ where: { mobile } }) };
        }

        it('stamps the consent version and time when the box is ticked', async () => {
            const { status, user } = await signUp({ telemedicineConsent: true });
            expect(status).toBe(200);
            expect(user!.telemedicineConsentVersion).toBe(room.CONSENT_VERSION);
            expect(user!.telemedicineConsentAt).toBeInstanceOf(Date);
        });

        it('records nothing for an older app build that sends no tick, or sends a non-true value', async () => {
            for (const body of [{}, { telemedicineConsent: false }, { telemedicineConsent: 'yes' }, { telemedicineConsent: 1 }]) {
                const { status, user } = await signUp(body);
                expect(status).toBe(200);
                expect(user!.telemedicineConsentVersion).toBeNull();
                expect(user!.telemedicineConsentAt).toBeNull();
            }
        });

        it('reports the consent back through /auth/me as a plain yes or no', async () => {
            const consented = await consentedUser();
            const plain = await makeUser();
            const read = async (user: { id: string; tokenVersion: number }) =>
                (await (await fetch(`${authApp.url}/auth/me`, { headers: { authorization: `Bearer ${tokenFor(user as any)}` } })).json()).user;

            expect((await read(consented as any)).telemedicineConsent).toBe(true);
            expect((await read(plain as any)).telemedicineConsent).toBe(false);
            // The raw version is internal and must not leak to the app.
            expect((await read(consented as any)).telemedicineConsentVersion).toBeUndefined();
        });
    });

    describe('when the sign-up consent counts for a consultation', () => {
        it('counts for the account holder booking for themselves', async () => {
            const user = await consentedUser();
            const b = await paidBooking(user);
            expect(await room.signupConsentFor(user.id, b.id)).toEqual({ channel: 'signup', version: room.CONSENT_VERSION, userId: user.id });
        });

        it('does not count for someone who never ticked it, or ticked an older wording', async () => {
            const user = await makeUser();
            const b = await paidBooking(user);
            expect(await room.signupConsentFor(user.id, b.id)).toBeNull();

            await testDb.user.update({ where: { id: user.id }, data: { telemedicineConsentVersion: 'nmc-2020-01-01' } });
            expect(await room.signupConsentFor(user.id, b.id)).toBeNull();
        });

        it('does not count for a stranger or an unknown consultation', async () => {
            const user = await consentedUser();
            const b = await paidBooking(user);
            const stranger = await consentedUser();
            expect(await room.signupConsentFor(stranger.id, b.id)).toBeNull();
            expect(await room.signupConsentFor(user.id, '11111111-1111-4111-8111-111111111111')).toBeNull();
        });
    });

    describe('consentOnFile on the booking view', () => {
        const view = async (user: { id: string; tokenVersion: number }, id: string) => {
            const res = await fetch(`${patientApp.url}/consult/bookings/${id}`, { headers: { authorization: `Bearer ${tokenFor(user as any)}` } });
            return { status: res.status, body: await res.json() };
        };

        it('is true for a booker who consented at sign-up', async () => {
            const user = await consentedUser();
            const b = await paidBooking(user);
            const res = await view(user as any, b.id);
            expect(res.status).toBe(200);
            expect(res.body.consentOnFile).toBe(true);
        });

        it('is false when the booker never consented, so the join screen must ask', async () => {
            const user = await makeUser();
            const b = await paidBooking(user);
            expect((await view(user as any, b.id)).body.consentOnFile).toBe(false);
        });

        it('stays out of a stranger\'s reach entirely', async () => {
            const user = await consentedUser();
            const b = await paidBooking(user);
            const stranger = await makeUser();
            expect((await view(stranger as any, b.id)).status).toBe(404);
        });
    });
});
