import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('in-call chat (real Postgres)', () => {
    let chat: typeof import('./consultations.chat');
    let patientApp: { url: string; close: () => Promise<void> };
    let doctorApp: { url: string; close: () => Promise<void> };
    let guestApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        chat = await import('./consultations.chat');
        const doctorRoutes = await import('./doctors.routes');
        const patientRoutes = await import('./consultations.routes');
        patientApp = await serve('/consult', patientRoutes.consultPatientRoutes);
        doctorApp = await serve('/doctor', doctorRoutes.doctorRoutes);
        guestApp = await serve('/consult', patientRoutes.consultGuestRoutes);
    });
    afterAll(async () => {
        await Promise.all([patientApp?.close(), doctorApp?.close(), guestApp?.close()]);
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    /** A consultation in the given state whose slot started `startedMinutesAgo` ago (15-minute slot from makeSlot). */
    async function consult(status: 'CONFIRMED' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' = 'IN_PROGRESS', startedMinutesAgo = 2) {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, -startedMinutesAgo, 'BOOKED');
        const c = await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt, status });
        return { doctor, user, patient, slot, c };
    }
    const id = () => `m-${randomUUID().slice(0, 12)}`;
    const call = (base: string, method: string, path: string, user: { id: string; tokenVersion: number } | null, body?: object) =>
        fetch(`${base}${path}`, {
            method,
            headers: { ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {}), 'content-type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        }).then(async (r) => ({ status: r.status, body: await r.json() }));

    describe('sending and reading', () => {
        it('patient and doctor see one thread in order, each marked mine for its sender, with names', async () => {
            const b = await consult();
            await chat.patientChat.send(b.user.id, b.c.id, { body: 'I have had a fever since Monday', clientId: id() });
            await chat.doctorChat.send(b.doctor.profile.id, b.c.id, { body: 'Any cough?', clientId: id() });
            const asPatient = await chat.patientChat.read(b.user.id, b.c.id, 0);
            const asDoctor = await chat.doctorChat.read(b.doctor.profile.id, b.c.id, 0);
            expect(asPatient.open).toBe(true);
            expect(asPatient.messages.map((m) => [m.from, m.mine, m.body])).toEqual([
                ['PATIENT', true, 'I have had a fever since Monday'],
                ['DOCTOR', false, 'Any cough?'],
            ]);
            expect(asDoctor.messages.map((m) => m.mine)).toEqual([false, true]);
            expect(asDoctor.messages[0].name).toBe('Test Patient');
            expect(asDoctor.messages[1].name).toMatch(/Dr/);
        });

        it('a resend with the same clientId is stored once', async () => {
            const b = await consult();
            const clientId = id();
            const first = await chat.patientChat.send(b.user.id, b.c.id, { body: 'hello', clientId });
            const again = await chat.patientChat.send(b.user.id, b.c.id, { body: 'hello', clientId });
            const racing = await Promise.all([1, 2, 3].map(() => chat.patientChat.send(b.user.id, b.c.id, { body: 'race', clientId: 'racing-1' })));
            expect(again.id).toBe(first.id);
            expect(new Set(racing.map((m) => m.id)).size).toBe(1);
            expect(await testDb.consultationMessage.count({ where: { consultationId: b.c.id } })).toBe(2);
        });

        it('cleans the body and enforces the length cap and empty text', async () => {
            const b = await consult();
            const m = await chat.patientChat.send(b.user.id, b.c.id, { body: '  line one\r\n\r\n\r\n\r\nline\u0007 two  ', clientId: id() });
            expect(m.body).toBe('line one\n\nline two');
            await expect(chat.patientChat.send(b.user.id, b.c.id, { body: ' \n\u0000 ', clientId: id() })).rejects.toMatchObject({ status: 400 });
            await expect(chat.patientChat.send(b.user.id, b.c.id, { body: 'x'.repeat(chat.CHAT_MAX_CHARS + 1), clientId: id() })).rejects.toMatchObject({ status: 400 });
            expect((await chat.patientChat.send(b.user.id, b.c.id, { body: 'x'.repeat(chat.CHAT_MAX_CHARS), clientId: id() })).body).toHaveLength(chat.CHAT_MAX_CHARS);
        });

        it('reads after a cursor, and re-sends the last few seconds so a late commit is never skipped', async () => {
            const b = await consult();
            const a = await chat.patientChat.send(b.user.id, b.c.id, { body: 'a', clientId: id() });
            const later = new Date(Date.now() + 60_000);
            const second = await chat.patientChat.send(b.user.id, b.c.id, { body: 'b', clientId: id() });
            // A minute on, only messages after the cursor come back.
            expect((await chat.patientChat.read(b.user.id, b.c.id, a.seq, later)).messages.map((m) => m.body)).toEqual(['b']);
            expect((await chat.patientChat.read(b.user.id, b.c.id, second.seq, later)).messages).toEqual([]);
            // Right now, the overlap also returns 'a' even though the cursor is past it.
            expect((await chat.patientChat.read(b.user.id, b.c.id, second.seq)).messages.map((m) => m.body)).toEqual(['a', 'b']);
        });

        it('stops at the per-consultation cap', async () => {
            const b = await consult();
            await testDb.consultationMessage.createMany({
                data: Array.from({ length: chat.CHAT_MAX_MESSAGES }, (_, i) => ({
                    consultationId: b.c.id, senderRole: 'PATIENT' as const, senderIdentity: `patient:${b.patient.id}`, body: `m${i}`, clientId: `seed-${i}-xxxx`,
                })),
            });
            await expect(chat.doctorChat.send(b.doctor.profile.id, b.c.id, { body: 'one more', clientId: id() })).rejects.toMatchObject({ status: 409, message: chat.CHAT_FULL });
        });

        it('pages long threads: hasMore until the last page', async () => {
            const b = await consult();
            const old = new Date(Date.now() - 3_600_000);
            await testDb.consultationMessage.createMany({
                data: Array.from({ length: chat.CHAT_PAGE + 20 }, (_, i) => ({
                    consultationId: b.c.id, senderRole: 'PATIENT' as const, senderIdentity: `patient:${b.patient.id}`, body: `m${i}`, clientId: `page-${i}-xxxx`, createdAt: old,
                })),
            });
            const first = await chat.patientChat.read(b.user.id, b.c.id, 0);
            expect([first.messages.length, first.hasMore]).toEqual([chat.CHAT_PAGE, true]);
            const second = await chat.patientChat.read(b.user.id, b.c.id, first.messages.at(-1)!.seq);
            expect([second.messages.length, second.hasMore]).toEqual([20, false]);
        });
    });

    describe('open and read-only', () => {
        it('is open while WAITING or IN_PROGRESS, not before anyone joined', async () => {
            const waiting = await consult('WAITING');
            await chat.patientChat.send(waiting.user.id, waiting.c.id, { body: 'waiting for you', clientId: id() });
            const confirmed = await consult('CONFIRMED');
            await expect(chat.patientChat.send(confirmed.user.id, confirmed.c.id, { body: 'hi', clientId: id() })).rejects.toMatchObject({ status: 409, message: chat.CHAT_CLOSED });
            expect((await chat.patientChat.read(confirmed.user.id, confirmed.c.id, 0)).open).toBe(false);
        });

        it('is read-only once completed, but both sides can still read it', async () => {
            const b = await consult();
            await chat.doctorChat.send(b.doctor.profile.id, b.c.id, { body: 'Take rest', clientId: id() });
            await testDb.consultation.update({ where: { id: b.c.id }, data: { status: 'COMPLETED', endedAt: new Date() } });
            await expect(chat.doctorChat.send(b.doctor.profile.id, b.c.id, { body: 'late', clientId: id() })).rejects.toMatchObject({ status: 409 });
            await expect(chat.patientChat.send(b.user.id, b.c.id, { body: 'late', clientId: id() })).rejects.toMatchObject({ status: 409 });
            const doc = await chat.doctorChat.read(b.doctor.profile.id, b.c.id, 0);
            const pat = await chat.patientChat.read(b.user.id, b.c.id, 0);
            expect([doc.open, pat.open]).toEqual([false, false]);
            expect(pat.messages.map((m) => m.body)).toEqual(['Take rest']);
        });

        it('closes an hour after the slot ends even if the doctor never pressed End', async () => {
            // makeSlot gives a 15-minute slot; started 95 minutes ago means it ended 80 minutes ago.
            const b = await consult('IN_PROGRESS', 95);
            await expect(chat.patientChat.send(b.user.id, b.c.id, { body: 'still there?', clientId: id() })).rejects.toMatchObject({ status: 409 });
        });

        it('chat-type consultations stay closed (not built yet)', async () => {
            const b = await consult();
            await testDb.consultation.update({ where: { id: b.c.id }, data: { type: 'CHAT' } });
            await expect(chat.patientChat.send(b.user.id, b.c.id, { body: 'hi', clientId: id() })).rejects.toMatchObject({ status: 409 });
        });
    });

    describe('who can read and write', () => {
        it('another user and another doctor get 404', async () => {
            const b = await consult();
            await chat.patientChat.send(b.user.id, b.c.id, { body: 'private', clientId: id() });
            const stranger = await makeUser();
            const otherDoctor = await makeDoctor();
            await expect(chat.patientChat.read(stranger.id, b.c.id, 0)).rejects.toMatchObject({ status: 404 });
            await expect(chat.patientChat.send(stranger.id, b.c.id, { body: 'x', clientId: id() })).rejects.toMatchObject({ status: 404 });
            await expect(chat.doctorChat.read(otherDoctor.profile.id, b.c.id, 0)).rejects.toMatchObject({ status: 404 });
        });

        it('a late-doctor reassign: the old doctor loses access, the new one sees only what came after, names stay right', async () => {
            const b = await consult('WAITING');
            await chat.patientChat.send(b.user.id, b.c.id, { body: 'I have chest pain', clientId: id() });
            await chat.doctorChat.send(b.doctor.profile.id, b.c.id, { body: 'Running 10 minutes late', clientId: id() });
            const newDoctor = await makeDoctor();
            await testDb.doctorProfile.update({ where: { id: newDoctor.profile.id }, data: { displayName: 'Anil Kumar' } });
            const slot2 = await makeSlot(newDoctor.profile.id, -1, 'BOOKED');
            await testDb.$transaction([
                testDb.consultationMove.create({ data: {
                    consultationId: b.c.id, kind: 'DOCTOR_LATE_REASSIGN', fromDoctorId: b.doctor.profile.id, fromSlotId: b.slot.id, fromStartsAt: b.slot.startsAt,
                    toDoctorId: newDoctor.profile.id, toSlotId: slot2.id, toStartsAt: slot2.startsAt,
                } }),
                testDb.consultation.update({ where: { id: b.c.id }, data: { doctorId: newDoctor.profile.id, slotId: slot2.id, startsAt: slot2.startsAt } }),
                testDb.slot.update({ where: { id: b.slot.id }, data: { status: 'AVAILABLE' } }),
            ]);
            await expect(chat.doctorChat.read(b.doctor.profile.id, b.c.id, 0)).rejects.toMatchObject({ status: 404 });
            expect((await chat.doctorChat.read(newDoctor.profile.id, b.c.id, 0)).messages).toEqual([]);
            await chat.patientChat.send(b.user.id, b.c.id, { body: 'Hello Dr Anil', clientId: id() });
            await chat.doctorChat.send(newDoctor.profile.id, b.c.id, { body: 'Hello, tell me more', clientId: id() });
            expect((await chat.doctorChat.read(newDoctor.profile.id, b.c.id, 0)).messages.map((m) => m.body)).toEqual(['Hello Dr Anil', 'Hello, tell me more']);
            // The patient keeps the whole thread, each doctor message under the doctor who wrote it.
            const mine = await chat.patientChat.read(b.user.id, b.c.id, 0);
            expect(mine.messages.filter((m) => m.from === 'DOCTOR').map((m) => [m.body, m.name])).toEqual([
                ['Running 10 minutes late', expect.stringContaining('Dr Test')],
                ['Hello, tell me more', expect.stringContaining('Anil Kumar')],
            ]);
        });

        it('family visit: the booker writes as caregiver, the accepted family member as patient, a pending one not at all', async () => {
            const b = await consult();
            const relative = await makeUser();
            await testDb.patient.update({ where: { id: b.patient.id }, data: { relation: 'Mother', phone: relative.mobile } });
            // Before accepting the link, the family member sees only doctor and time.
            await expect(chat.patientChat.read(relative.id, b.c.id, 0)).rejects.toMatchObject({ status: 409 });
            await testDb.patient.update({ where: { id: b.patient.id }, data: { linkedUserId: relative.id, linkedAt: new Date() } });
            const fromBooker = await chat.patientChat.send(b.user.id, b.c.id, { body: 'I am her son', clientId: id() });
            const fromMum = await chat.patientChat.send(relative.id, b.c.id, { body: 'Hello doctor', clientId: id() });
            expect([fromBooker.from, fromMum.from]).toEqual(['CARETAKER', 'PATIENT']);
            expect(fromBooker.name).toMatch(/\(family\)$/);
            const mumView = await chat.patientChat.read(relative.id, b.c.id, 0);
            expect(mumView.messages.map((m) => m.mine)).toEqual([false, true]);
        });

        it('the guest link reads and writes as the patient while the visit is on, and expires with it', async () => {
            const b = await consult();
            const token = randomUUID();
            await testDb.consultation.update({ where: { id: b.c.id }, data: { guestToken: token } });
            const sent = await call(guestApp.url, 'POST', `/consult/guest/${token}/chat`, null, { body: 'Namaste', clientId: id() });
            expect(sent.status).toBe(200);
            expect(sent.body).toMatchObject({ from: 'PATIENT', mine: true });
            // The signed-in booker of their own visit is the same patient identity, so it is "mine" there too.
            expect((await chat.patientChat.read(b.user.id, b.c.id, 0)).messages[0].mine).toBe(true);
            expect((await call(guestApp.url, 'GET', `/consult/guest/${randomUUID()}/chat`, null)).status).toBe(404);
            expect((await call(guestApp.url, 'GET', `/consult/guest/not-a-token/chat`, null)).status).toBe(404);
            // A call nobody ended: the link still expires 15 minutes after the slot, as for joining.
            const after = new Date(b.slot.endsAt.getTime() + 16 * 60_000);
            await expect(chat.guestChat.read(token, 0, after)).rejects.toMatchObject({ status: 410 });
            await testDb.consultation.update({ where: { id: b.c.id }, data: { status: 'COMPLETED', endedAt: new Date() } });
            expect((await call(guestApp.url, 'GET', `/consult/guest/${token}/chat`, null)).status).toBe(410);
        });
    });

    describe('over HTTP', () => {
        it('patient and doctor routes send, read with a cursor, and refuse bad input', async () => {
            const b = await consult();
            const sent = await call(patientApp.url, 'POST', `/consult/bookings/${b.c.id}/chat`, b.user, { body: 'hi', clientId: id() });
            expect(sent.status).toBe(200);
            const doc = await call(doctorApp.url, 'POST', `/doctor/me/consultations/${b.c.id}/chat`, b.doctor.user, { body: 'hello', clientId: id() });
            expect(doc.status).toBe(200);
            const read = await call(doctorApp.url, 'GET', `/doctor/me/consultations/${b.c.id}/chat?after=0`, b.doctor.user);
            expect(read.body.messages.map((m: { body: string }) => m.body)).toEqual(['hi', 'hello']);
            expect((await call(patientApp.url, 'POST', `/consult/bookings/${b.c.id}/chat`, b.user, { body: 'hi', clientId: 'bad id!' })).status).toBe(400);
            expect((await call(patientApp.url, 'GET', `/consult/bookings/${b.c.id}/chat?after=-1`, b.user)).status).toBe(400);
            expect((await call(patientApp.url, 'GET', `/consult/bookings/${b.c.id}/chat?after=9999999999`, b.user)).status).toBe(400);
            expect((await call(patientApp.url, 'GET', `/consult/bookings/not-a-uuid/chat`, b.user)).status).toBe(404);
            expect((await call(patientApp.url, 'GET', `/consult/bookings/${b.c.id}/chat`, null)).status).toBe(401);
        });
    });
});
