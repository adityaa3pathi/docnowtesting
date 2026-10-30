import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';
import type { ConsultationStatus } from './consultations.types';

useTestJwtSecret();

describeDb('doctor consultation list (real Postgres)', () => {
    let app: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        const routes = await import('./doctors.routes');
        app = await serve('/doctor', routes.doctorRoutes);
    });
    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });
    beforeEach(resetConsultData);

    const get = (qs: string, token?: string) =>
        fetch(`${app.url}/doctor/me/consultations${qs}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

    async function book(doctorId: string, status: ConsultationStatus, minutes: number, patientName?: string) {
        const user = await makeUser();
        const patient = await makePatient(user.id);
        if (patientName) await testDb.patient.update({ where: { id: patient.id }, data: { name: patientName } });
        const slot = await makeSlot(doctorId, minutes, 'BOOKED');
        return makeConsultation({ userId: user.id, patientId: patient.id, doctorId, slotId: slot.id, startsAt: slot.startsAt, status });
    }

    it('shows the doctor their own paid booking with the patient name and nothing about money', async () => {
        const d = await makeDoctor();
        const c = await book(d.profile.id, 'CONFIRMED', 600, 'Asha Rao');
        const res = await get('?scope=upcoming', tokenFor(d.user));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({ id: c.id, status: 'CONFIRMED', type: 'VIDEO', patientName: 'Asha Rao' });
        expect(Object.keys(body.items[0]).sort()).toEqual(['endsAt', 'id', 'patientName', 'startsAt', 'status', 'type']);
        expect(JSON.stringify(body)).not.toMatch(/payment|refund|fee|mobile|user/i);
    });

    it('never shows another doctor\'s bookings', async () => {
        const a = await makeDoctor();
        const b = await makeDoctor();
        await book(b.profile.id, 'CONFIRMED', 600);
        expect((await (await get('?scope=upcoming', tokenFor(a.user))).json()).items).toEqual([]);
        expect((await (await get('?scope=past', tokenFor(a.user))).json()).items).toEqual([]);
    });

    it('refuses patients, anonymous callers and doctors who are not approved', async () => {
        const patient = await makeUser();
        expect((await get('?scope=upcoming', tokenFor(patient))).status).toBe(403);
        expect((await get('?scope=upcoming')).status).toBe(401);
        for (const status of ['PENDING', 'SUSPENDED'] as const) {
            const d = await makeDoctor({ status });
            expect((await get('?scope=upcoming', tokenFor(d.user))).status).toBe(403);
        }
    });

    it('leaves out unpaid holds and expired bookings', async () => {
        const d = await makeDoctor();
        await book(d.profile.id, 'PENDING_PAYMENT', 600);
        await book(d.profile.id, 'EXPIRED', -600);
        const t = tokenFor(d.user);
        expect((await (await get('?scope=upcoming', t)).json()).items).toEqual([]);
        expect((await (await get('?scope=past', t)).json()).items).toEqual([]);
    });

    it('puts finished, cancelled and ended-but-live bookings in past, newest first', async () => {
        const d = await makeDoctor();
        const old = await book(d.profile.id, 'COMPLETED', -3000);
        const mid = await book(d.profile.id, 'CANCELLED', -2000);
        const ended = await book(d.profile.id, 'CONFIRMED', -1000);
        const refunded = await book(d.profile.id, 'REFUNDED', -500);
        const t = tokenFor(d.user);
        const past = (await (await get('?scope=past', t)).json()).items.map((i: any) => i.id);
        expect(past).toEqual([refunded.id, ended.id, mid.id, old.id]);
        expect((await (await get('?scope=upcoming', t)).json()).items).toEqual([]);
    });

    it('lists upcoming soonest first and keeps a slot that is still running', async () => {
        const d = await makeDoctor();
        const later = await book(d.profile.id, 'WAITING', 900);
        const running = await book(d.profile.id, 'IN_PROGRESS', -5);
        const soon = await book(d.profile.id, 'RESCHEDULED', 300);
        const items = (await (await get('?scope=upcoming', tokenFor(d.user))).json()).items.map((i: any) => i.id);
        expect(items).toEqual([running.id, soon.id, later.id]);
    });

    it('pages with a cursor without gaps or duplicates, even for the same start time', async () => {
        const d = await makeDoctor();
        const first = await book(d.profile.id, 'COMPLETED', -3000);
        const shared = await book(d.profile.id, 'COMPLETED', -2000);
        const twins = [shared.id];
        for (const status of ['CANCELLED', 'REFUNDED'] as const) {
            const user = await makeUser();
            const c = await makeConsultation({
                userId: user.id, patientId: (await makePatient(user.id)).id, doctorId: d.profile.id,
                slotId: shared.slotId, startsAt: shared.startsAt, status,
            });
            twins.push(c.id);
        }
        const t = tokenFor(d.user);
        const p1 = await (await get('?scope=past&limit=2', t)).json();
        expect(p1.items).toHaveLength(2);
        expect(p1.nextCursor).toBeTruthy();
        const p2 = await (await get(`?scope=past&limit=2&cursor=${p1.nextCursor}`, t)).json();
        const all = [...p1.items, ...p2.items].map((i: any) => i.id);
        expect(all).toHaveLength(4);
        expect(new Set(all)).toEqual(new Set([first.id, ...twins]));
        expect(all[3]).toBe(first.id);
        expect(p2.nextCursor).toBeNull();
    });

    it('pages past bookings newest first', async () => {
        const d = await makeDoctor();
        const a = await book(d.profile.id, 'COMPLETED', -3000);
        const b = await book(d.profile.id, 'COMPLETED', -2000);
        const c = await book(d.profile.id, 'COMPLETED', -1000);
        const t = tokenFor(d.user);
        const p1 = await (await get('?scope=past&limit=2', t)).json();
        const p2 = await (await get(`?scope=past&limit=2&cursor=${p1.nextCursor}`, t)).json();
        expect([...p1.items, ...p2.items].map((i: any) => i.id)).toEqual([c.id, b.id, a.id]);
    });

    it('clamps a large limit, and rejects a bad scope, limit or cursor', async () => {
        const d = await makeDoctor();
        for (let i = 0; i < 51; i++) await book(d.profile.id, 'CONFIRMED', 100 + i);
        const t = tokenFor(d.user);
        const big = await (await get('?scope=upcoming&limit=500', t)).json();
        expect(big.items).toHaveLength(50);
        expect(big.nextCursor).toBeTruthy();
        expect((await get('?scope=sideways', t)).status).toBe(400);
        expect((await get('', t)).status).toBe(400);
        expect((await get('?scope=upcoming&limit=0', t)).status).toBe(400);
        expect((await get('?scope=upcoming&cursor=garbage', t)).status).toBe(400);
    });
});
