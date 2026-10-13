import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeVideo } from './test/fakeVideo';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('video consultations: join, notes, prescription (real Postgres)', () => {
    let room: typeof import('./consultations.room');
    let rx: typeof import('./consultations.prescription');
    let video: FakeVideo;
    let patientApp: { url: string; close: () => Promise<void> };
    let doctorApp: { url: string; close: () => Promise<void> };
    let adminApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        room = await import('./consultations.room');
        rx = await import('./consultations.prescription');
        const doctorRoutes = await import('./doctors.routes');
        const patientRoutes = await import('./consultations.routes');
        patientApp = await serve('/consult', patientRoutes.consultPatientRoutes);
        doctorApp = await serve('/doctor', doctorRoutes.doctorRoutes);
        adminApp = await serve('/admin', doctorRoutes.consultAdminRoutes);
    });
    afterAll(async () => {
        await Promise.all([patientApp?.close(), doctorApp?.close(), adminApp?.close()]);
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        await testDb.cartItem.deleteMany({ where: { testCode: { startsWith: 'RXT-' } } });
        video = new FakeVideo();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    /** A paid consultation whose slot starts `startsInMinutes` from now. */
    async function confirmed(startsInMinutes = 5, type: 'VIDEO' | 'AUDIO' = 'VIDEO') {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, startsInMinutes, 'BOOKED');
        const c = await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt, status: 'CONFIRMED' });
        if (type === 'AUDIO') await testDb.consultation.update({ where: { id: c.id }, data: { type } });
        return { doctor, user, patient, slot, c };
    }
    const status = async (id: string) => (await testDb.consultation.findUniqueOrThrow({ where: { id } })).status;
    const post = (url: string, token: string, body?: object) =>
        fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const put = (url: string, token: string, body: object) =>
        fetch(url, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

    async function catalogTest(code: string, enabled = true) {
        return testDb.catalogItem.upsert({
            where: { partnerCode: code },
            update: { isEnabled: enabled },
            create: { partnerCode: code, name: `Test ${code}`, partnerPrice: 100, displayPrice: 300, discountedPrice: 250, isEnabled: enabled },
        });
    }

    describe('joining', () => {
        it('lets the patient join from 10 minutes before, once per room, and moves to WAITING', async () => {
            const b = await confirmed(5);
            const first = await room.patientJoin(b.user.id, b.c.id, { video });
            const again = await room.patientJoin(b.user.id, b.c.id, { video });
            expect(first).toMatchObject({ roomId: `room-consult-${b.c.id}`, role: 'patient' });
            expect(again.roomId).toBe(first.roomId);
            expect(video.roomsCreated).toHaveLength(1);
            expect(await status(b.c.id)).toBe('WAITING');
        });

        it('refuses too early and after the end', async () => {
            const early = await confirmed(60);
            await expect(room.patientJoin(early.user.id, early.c.id, { video })).rejects.toMatchObject({ status: 409 });
            const late = await confirmed(-40);
            await expect(room.patientJoin(late.user.id, late.c.id, { video })).rejects.toMatchObject({ status: 409 });
            expect(video.roomsCreated).toHaveLength(0);
        });

        it('starts the call when the doctor joins, even before the patient', async () => {
            const b = await confirmed(2);
            const r = await room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video });
            expect(r.role).toBe('doctor');
            const row = await testDb.consultation.findUniqueOrThrow({ where: { id: b.c.id } });
            expect(row.status).toBe('IN_PROGRESS');
            expect(row.startedAt).not.toBeNull();
            await room.patientJoin(b.user.id, b.c.id, { video });
            expect(await status(b.c.id)).toBe('IN_PROGRESS');
        });

        it('gives audio-only roles for audio bookings', async () => {
            const b = await confirmed(2, 'AUDIO');
            expect((await room.patientJoin(b.user.id, b.c.id, { video })).role).toBe('patient-audio');
            expect((await room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video })).role).toBe('doctor-audio');
        });

        it('keeps other patients and doctors out', async () => {
            const b = await confirmed(2);
            const stranger = await makeUser();
            const otherDoctor = await makeDoctor();
            await expect(room.patientJoin(stranger.id, b.c.id, { video })).rejects.toMatchObject({ status: 404 });
            await expect(room.doctorJoin(otherDoctor.profile.id, otherDoctor.user.id, b.c.id, { video })).rejects.toMatchObject({ status: 404 });
            const res = await post(`${patientApp.url}/consult/bookings/${b.c.id}/join`, tokenFor(stranger as any));
            expect(res.status).toBe(404);
        });

        it('answers 503 through the route while 100ms keys are missing', async () => {
            const b = await confirmed(2);
            const res = await post(`${patientApp.url}/consult/bookings/${b.c.id}/join`, tokenFor(b.user as any));
            expect(res.status).toBe(503);
            expect(await status(b.c.id)).toBe('CONFIRMED');
        });

        it('lets only the doctor end a call in progress', async () => {
            const b = await confirmed(2);
            await expect(room.endConsultation(b.doctor.profile.id, b.c.id)).rejects.toMatchObject({ status: 409 });
            await room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video });
            const res = await post(`${doctorApp.url}/doctor/me/consultations/${b.c.id}/end`, tokenFor(b.doctor.user as any));
            expect(res.status).toBe(200);
            expect(await status(b.c.id)).toBe('COMPLETED');
        });
    });

    describe('notes and prescription', () => {
        async function started() {
            const b = await confirmed(2);
            await room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video });
            return b;
        }

        it('opens notes only after the call starts', async () => {
            const b = await confirmed(2);
            await expect(rx.saveNotes(b.doctor.profile.id, b.c.id, { complaints: 'fever' })).rejects.toMatchObject({ status: 409 });
            await room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video });
            const res = await put(`${doctorApp.url}/doctor/me/consultations/${b.c.id}/notes`, tokenFor(b.doctor.user as any), { complaints: 'fever', followUpDays: 7 });
            expect(res.status).toBe(200);
            expect((await rx.getDoctorRecord(b.doctor.profile.id, b.c.id)).note).toMatchObject({ complaints: 'fever', followUpDays: 7 });
        });

        it('issues once, freezes doctor and patient details, and locks the notes', async () => {
            const b = await started();
            await catalogTest('RXT-1');
            const url = `${doctorApp.url}/doctor/me/consultations/${b.c.id}/prescription`;
            const token = tokenFor(b.doctor.user as any);
            const body = { medicines: [{ name: 'Paracetamol 500mg', dose: '1 tab', frequency: 'Twice a day', duration: '3 days' }], testCodes: ['RXT-1'], advice: 'Rest' };
            const first = await post(url, token, body);
            expect(first.status).toBe(201);
            const issued = await first.json();
            expect(issued.recommendedTests).toEqual([{ code: 'RXT-1', name: 'Test RXT-1' }]);
            expect(issued.doctorSnapshot).toMatchObject({ displayName: 'Dr Test', registrationCouncil: 'Test Council' });
            expect((await post(url, token, body)).status).toBe(409);
            await expect(rx.saveNotes(b.doctor.profile.id, b.c.id, { advice: 'edit' })).rejects.toMatchObject({ status: 409 });
        });

        it('rejects unknown or disabled tests and empty prescriptions', async () => {
            const b = await started();
            await catalogTest('RXT-OFF', false);
            await expect(rx.issuePrescription(b.doctor.profile.id, b.c.id, { medicines: [], testCodes: ['RXT-OFF'] })).rejects.toMatchObject({ status: 400 });
            const res = await post(`${doctorApp.url}/doctor/me/consultations/${b.c.id}/prescription`, tokenFor(b.doctor.user as any), { medicines: [], testCodes: [] });
            expect(res.status).toBe(400);
        });

        it('serves the PDF to the patient only, and adds recommended tests to their cart once', async () => {
            const b = await started();
            await catalogTest('RXT-2');
            await rx.issuePrescription(b.doctor.profile.id, b.c.id, { medicines: [], testCodes: ['RXT-2'], advice: 'Fast 10 hours' });

            const pdf = await fetch(`${patientApp.url}/consult/bookings/${b.c.id}/prescription.pdf`, { headers: { authorization: `Bearer ${tokenFor(b.user as any)}` } });
            expect(pdf.headers.get('content-type')).toBe('application/pdf');
            expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
            const stranger = await makeUser();
            const denied = await fetch(`${patientApp.url}/consult/bookings/${b.c.id}/prescription.pdf`, { headers: { authorization: `Bearer ${tokenFor(stranger as any)}` } });
            expect(denied.status).toBe(404);

            const cartUrl = `${patientApp.url}/consult/bookings/${b.c.id}/recommended-tests/cart`;
            expect(await (await post(cartUrl, tokenFor(b.user as any))).json()).toEqual({ added: ['RXT-2'], skipped: [] });
            expect((await (await post(cartUrl, tokenFor(b.user as any))).json()).added).toEqual([]);
            const items = await testDb.cartItem.findMany({ where: { testCode: 'RXT-2', cart: { userId: b.user.id } } });
            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({ patientId: b.patient.id, price: 250, mrp: 300 });
        });
    });

    describe('admin appointments', () => {
        it('lists the IST day without clinical details', async () => {
            const b = await confirmed(2);
            const admin = await makeUser('SUPER_ADMIN');
            const day = new Date(b.slot.startsAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
            const res = await fetch(`${adminApp.url}/admin/appointments?date=${day}`, { headers: { authorization: `Bearer ${tokenFor(admin as any)}` } });
            expect(res.status).toBe(200);
            const body = await res.json();
            const row = body.items.find((i: any) => i.id === b.c.id);
            expect(row).toMatchObject({ status: 'CONFIRMED', patient: { name: 'Test Patient' } });
            expect(row).not.toHaveProperty('note');
            const patientRes = await fetch(`${adminApp.url}/admin/appointments`, { headers: { authorization: `Bearer ${tokenFor(b.user as any)}` } });
            expect(patientRes.status).toBe(403);
        });
    });
});
