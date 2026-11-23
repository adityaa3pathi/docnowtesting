/**
 * Allergies: "no known allergies" is told apart from "never asked", every writer records it the
 * same way, and the doctor of a booking sees it. Real Postgres, through the HTTP routes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { patientWriteData, resolveOrCreateSelfPatient } from '../../utils/patientValidation';
import { describeDb, makeConsultation, makeDoctor, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describe('patientWriteData', () => {
    const now = new Date('2026-11-24T05:00:00Z');
    it('records the confirmation for a list or for "no known allergies"', () => {
        expect(patientWriteData({ allergies: ['Penicillin'] }, now)).toEqual({ allergies: ['Penicillin'], allergiesConfirmedAt: now });
        expect(patientWriteData({ noKnownAllergies: true }, now)).toEqual({ allergies: [], allergiesConfirmedAt: now });
        expect(patientWriteData({ allergies: [], noKnownAllergies: true }, now)).toEqual({ allergies: [], allergiesConfirmedAt: now });
    });
    it('treats an empty list without the flag as "not asked", and leaves allergies alone when both are left out', () => {
        expect(patientWriteData({ allergies: [] }, now)).toEqual({ allergies: [], allergiesConfirmedAt: null });
        expect(patientWriteData({ bloodGroup: 'O+' } as { bloodGroup: string }, now)).toEqual({ bloodGroup: 'O+' });
    });
});

describeDb('allergies (real Postgres)', () => {
    let profile: { url: string; close: () => Promise<void> };
    let doctor: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        const patients = (await import('../../routes/patients')).default;
        profile = await serve('/profile/patients', patients);
        doctor = await serve('/doctor', (await import('./doctors.routes')).doctorRoutes);
    });
    afterAll(async () => {
        await profile?.close();
        await doctor?.close();
        await testDb?.$disconnect();
    });
    beforeEach(resetConsultData);

    const send = (method: string, path: string, token: string, body?: unknown) =>
        fetch(`${profile.url}/profile/patients${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

    async function selfOf(user: { id: string; tokenVersion: number }) {
        const res = await send('POST', '/ensure-self', tokenFor(user));
        expect(res.status).toBe(200);
        return (await res.json()) as { id: string; allergiesConfirmedAt: string | null };
    }

    it('starts unconfirmed, and "No known allergies" confirms with an empty list', async () => {
        const user = await makeUser();
        const self = await selfOf(user);
        expect(self.allergiesConfirmedAt).toBeNull();

        const res = await send('PATCH', `/${self.id}`, tokenFor(user), { noKnownAllergies: true });
        expect(res.status).toBe(200);
        const row = await testDb.patient.findUniqueOrThrow({ where: { id: self.id } });
        expect(row.allergies).toEqual([]);
        expect(row.allergiesConfirmedAt).toBeInstanceOf(Date);
    });

    it('a listed allergy confirms; clearing the list without the flag goes back to "not asked"', async () => {
        const user = await makeUser();
        const self = await selfOf(user);
        await send('PATCH', `/${self.id}`, tokenFor(user), { allergies: ['Penicillin', ' Penicillin ', 'Sulfa'] });
        let row = await testDb.patient.findUniqueOrThrow({ where: { id: self.id } });
        expect(row.allergies).toEqual(['Penicillin', 'Sulfa']);
        expect(row.allergiesConfirmedAt).not.toBeNull();

        await send('PATCH', `/${self.id}`, tokenFor(user), { allergies: [] });
        row = await testDb.patient.findUniqueOrThrow({ where: { id: self.id } });
        expect(row.allergies).toEqual([]);
        expect(row.allergiesConfirmedAt).toBeNull();
    });

    it('refuses a list together with "No known allergies"', async () => {
        const user = await makeUser();
        const self = await selfOf(user);
        const res = await send('PATCH', `/${self.id}`, tokenFor(user), { allergies: ['Peanuts'], noKnownAllergies: true });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/No known allergies/);
        expect((await testDb.patient.findUniqueOrThrow({ where: { id: self.id } })).allergiesConfirmedAt).toBeNull();
    });

    it('editing name or age from the family list keeps the allergies and their confirmation', async () => {
        const user = await makeUser();
        const created = await send('POST', '', tokenFor(user), { name: 'Kamla', relation: 'Parent', age: 70, gender: 'Female', allergies: ['Aspirin'] });
        expect(created.status).toBe(201);
        const { patient } = await created.json();
        const before = await testDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
        expect(before.allergiesConfirmedAt).not.toBeNull();

        const res = await send('PUT', `/${patient.id}`, tokenFor(user), { name: 'Kamla Devi', relation: 'Parent', age: 71, gender: 'Female' });
        expect(res.status).toBe(200);
        const after = await testDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
        expect(after).toMatchObject({ name: 'Kamla Devi', allergies: ['Aspirin'] });
        expect(after.allergiesConfirmedAt).toEqual(before.allergiesConfirmedAt);
    });

    it('nobody else can read or change a person\'s health details', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        const self = await selfOf(owner);
        const res = await send('PATCH', `/${self.id}`, tokenFor(other), { allergies: ['Latex'] });
        expect(res.status).toBe(404);
        const list = await (await send('GET', '', tokenFor(other))).json();
        expect(list.map((p: { id: string }) => p.id)).not.toContain(self.id);
        expect((await testDb.patient.findUniqueOrThrow({ where: { id: self.id } })).allergies).toEqual([]);
    });

    it('the booking\'s doctor sees the allergies and when they were confirmed; another doctor gets 404', async () => {
        const user = await makeUser();
        const self = await selfOf(user);
        await send('PATCH', `/${self.id}`, tokenFor(user), { allergies: ['Penicillin'] });
        const d = await makeDoctor();
        const slot = await makeSlot(d.profile.id, 600, 'BOOKED');
        const c = await makeConsultation({ userId: user.id, patientId: self.id, doctorId: d.profile.id, slotId: slot.id, startsAt: slot.startsAt, status: 'CONFIRMED' });

        const res = await fetch(`${doctor.url}/doctor/me/consultations/${c.id}`, { headers: { authorization: `Bearer ${tokenFor(d.user)}` } });
        expect(res.status).toBe(200);
        const record = await res.json();
        expect(record.patient.allergies).toEqual(['Penicillin']);
        expect(typeof record.patient.allergiesConfirmedAt).toBe('string');

        const stranger = await makeDoctor();
        const denied = await fetch(`${doctor.url}/doctor/me/consultations/${c.id}`, { headers: { authorization: `Bearer ${tokenFor(stranger.user)}` } });
        expect(denied.status).toBe(404);
    });

    describe('one "Self" person per account', () => {
        it('parallel calls make exactly one, so saved allergies are never on a twin', async () => {
            const user = await makeUser();
            const made = await Promise.all(Array.from({ length: 6 }, () => resolveOrCreateSelfPatient(user.id, testDb)));
            expect(new Set(made.map((p) => p.id)).size).toBe(1);
            expect(await testDb.patient.count({ where: { userId: user.id, relation: 'Self' } })).toBe(1);
        });

        it('also inside callers\' own transactions (checkout and manager orders)', async () => {
            const user = await makeUser();
            const made = await Promise.all(Array.from({ length: 4 }, () =>
                testDb.$transaction((tx) => resolveOrCreateSelfPatient(user.id, tx as never))));
            expect(new Set(made.map((p) => p.id)).size).toBe(1);
            expect(await testDb.patient.count({ where: { userId: user.id, relation: 'Self' } })).toBe(1);
        });

        it('an account that already has two "Self" rows always gets the same one', async () => {
            const user = await makeUser();
            const twins = await Promise.all([0, 1].map(() => testDb.patient.create({ data: { userId: user.id, name: 'Twin', relation: 'Self', age: 30, gender: 'Male' } })));
            const first = [...twins].sort((a, b) => a.id.localeCompare(b.id))[0];
            for (let i = 0; i < 3; i++) expect((await resolveOrCreateSelfPatient(user.id, testDb)).id).toBe(first.id);
        });

        it('the route answers parallel requests with the same person', async () => {
            const user = await makeUser();
            const ids = await Promise.all([0, 1, 2].map(async () => (await (await send('POST', '/ensure-self', tokenFor(user))).json()).id));
            expect(new Set(ids).size).toBe(1);
        });
    });
});

