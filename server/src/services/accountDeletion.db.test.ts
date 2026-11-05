/** HTTP + Postgres checks for DELETE /api/profile. Runs only when TEST_DATABASE_URL is set. */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { serve, tokenFor, useTestJwtSecret } from '../modules/consultations/test/http';
import { describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from '../modules/consultations/test/db';

useTestJwtSecret();

describeDb('DELETE /api/profile', () => {
    let app: Awaited<ReturnType<typeof serve>>;
    let svc: typeof import('./accountDeletion');

    beforeAll(async () => {
        svc = await import('./accountDeletion');
        const { default: profileRoutes } = await import('../routes/profile');
        app = await serve('/api/profile', profileRoutes);
    });
    afterAll(() => app.close());
    beforeEach(() => resetConsultData());

    const del = (user: { id: string; tokenVersion: number } | null) =>
        fetch(`${app.url}/api/profile`, { method: 'DELETE', headers: user ? { authorization: `Bearer ${tokenFor(user)}` } : {} });
    const me = (user: { id: string; tokenVersion: number }) =>
        fetch(`${app.url}/api/profile`, { headers: { authorization: `Bearer ${tokenFor(user)}` } });

    async function withConsultation(status: 'CONFIRMED' | 'IN_PROGRESS' | 'WAITING' | 'COMPLETED') {
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const doctor = await makeDoctor();
        const slot = await makeSlot(doctor.profile.id, 60, 'BOOKED');
        const c = await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt, status });
        return { user, patient, c };
    }

    it('requires sign-in', async () => {
        expect((await del(null)).status).toBe(401);
    });

    it('removes push tokens and sessions, wipes contact details and signs the account out everywhere', async () => {
        const user = await makeUser();
        const mobile = user.mobile;
        await testDb.pushToken.create({ data: { userId: user.id, token: `ExponentPushToken[del-${user.id.slice(0, 8)}]`, platform: 'ios' } });
        await testDb.session.create({ data: { userId: user.id, refreshTokenHash: `hash-${user.id}`, familyId: user.id, expiresAt: new Date(Date.now() + 86_400_000), clientType: 'mobile' } });
        await testDb.address.create({ data: { userId: user.id, line1: '12 MG Road', city: 'Bengaluru', pincode: '560001', lat: '12.9', long: '77.6' } });
        const unused = await makePatient(user.id);
        await expect(me(user)).resolves.toMatchObject({ status: 200 });

        const res = await del(user);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, message: 'Account deleted successfully' });

        expect(await testDb.pushToken.count({ where: { userId: user.id } })).toBe(0);
        expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
        const after = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
        expect(after).toMatchObject({ name: null, email: null, mobile: svc.deletedMobile(user.id), status: 'BLOCKED', tokenVersion: user.tokenVersion + 1 });
        expect(after.deletedAt).not.toBeNull();
        expect(await testDb.user.findUnique({ where: { mobile } })).toBeNull();
        expect(await testDb.address.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ isDeleted: true, lat: null, long: null });
        expect(await testDb.patient.findUnique({ where: { id: unused.id } })).toBeNull();

        // The old access token no longer works, and a second delete finds nothing.
        expect((await me(user)).status).toBe(401);
        expect((await del(user)).status).toBe(401);
    });

    it('rejects deletion while a consultation is confirmed or in progress', async () => {
        for (const status of ['CONFIRMED', 'IN_PROGRESS'] as const) {
            const { user } = await withConsultation(status);
            const res = await del(user);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: 'Please complete or cancel your upcoming consultation before deleting your account' });
            expect(await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ status: 'ACTIVE', deletedAt: null, mobile: user.mobile });
        }
    });

    it('keeps the de-identified medical record of a finished consultation', async () => {
        const { user, patient, c } = await withConsultation('COMPLETED');
        await testDb.patient.update({ where: { id: patient.id }, data: { phone: '9876543210' } });
        expect((await del(user)).status).toBe(200);
        expect(await testDb.consultation.findUnique({ where: { id: c.id } })).not.toBeNull();
        expect(await testDb.patient.findUniqueOrThrow({ where: { id: patient.id } })).toMatchObject({ phone: null, linkedUserId: null });
    });

    it('unlinks family profiles other people made for this number', async () => {
        const booker = await makeUser();
        const member = await makeUser();
        const profile = await testDb.patient.create({
            data: { userId: booker.id, name: 'Sunita', relation: 'MOTHER', age: 62, gender: 'F', phone: member.mobile, linkedUserId: member.id, linkedAt: new Date() },
        });
        expect((await del(member)).status).toBe(200);
        expect(await testDb.patient.findUniqueOrThrow({ where: { id: profile.id } })).toMatchObject({ linkedUserId: null, linkedAt: null });
        expect(await testDb.user.findUniqueOrThrow({ where: { id: booker.id } })).toMatchObject({ status: 'ACTIVE' });
    });

    it('sends doctor accounts to support', async () => {
        const doctor = await makeDoctor();
        const res = await del(doctor.user);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: svc.STAFF_ACCOUNT_MESSAGE });
    });
});
