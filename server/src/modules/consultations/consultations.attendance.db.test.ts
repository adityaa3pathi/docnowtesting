import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { describeDb, makeDoctor, makeSlot, makeUser, resetConsultData, testDb, makeConsultation } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

const getJson = async (url: string, token?: string) => {
    const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.status, body: await res.json().catch(() => null) as any };
};

const DAY = 24 * 3_600_000;
const MIN = 60_000;
/** The IST calendar day `daysAgo` days back, as YYYY-MM-DD. */
const istDay = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY + 330 * MIN).toISOString().slice(0, 10);

describeDb('manager report: consultation no-shows and late joins (real Postgres)', () => {
    let app: { url: string; close: () => Promise<void> };
    let managerToken: string;

    beforeAll(async () => {
        const { consultManagerRoutes } = await import('./consultations.manager.routes');
        app = await serve('/manager/consult', consultManagerRoutes);
    });
    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        const manager = await makeUser();
        managerToken = tokenFor(await testDb.user.update({ where: { id: manager.id }, data: { role: 'MANAGER' } }));
    });

    async function booking(input: {
        doctor: { profile: { id: string } }; patient: { id: string; userId: string }; daysAgo: number; status: string;
        doctorJoinMin?: number | null; patientJoinMin?: number | null; doctorNoShowRefund?: boolean;
    }) {
        const startsAt = new Date(Math.floor((Date.now() - input.daysAgo * DAY) / MIN) * MIN);
        const slot = await makeSlot(input.doctor.profile.id, 0, 'BOOKED');
        await testDb.slot.update({ where: { id: slot.id }, data: { startsAt, endsAt: new Date(startsAt.getTime() + 15 * MIN) } });
        const c = await makeConsultation({ userId: input.patient.userId, patientId: input.patient.id, doctorId: input.doctor.profile.id, slotId: slot.id, startsAt, status: input.status as any });
        const join = (m: number | null | undefined) => (m == null ? null : new Date(startsAt.getTime() + m * MIN));
        await testDb.consultation.update({ where: { id: c.id }, data: { doctorJoinedAt: join(input.doctorJoinMin), patientJoinedAt: join(input.patientJoinMin) } });
        if (input.doctorNoShowRefund) {
            const pay = await testDb.consultationPayment.create({ data: { consultationId: c.id, razorpayOrderId: `order_${randomUUID()}`, amountPaise: 50000, status: 'CAPTURED' } });
            await testDb.consultationRefund.create({ data: { consultationId: c.id, paymentId: pay.id, reason: 'DOCTOR_NO_SHOW', amountPaise: 50000, status: 'PROCESSED', receipt: `rf_${randomUUID().slice(0, 20)}` } });
        }
        return c;
    }

    async function person(name: string) {
        const user = await makeUser();
        return testDb.patient.create({ data: { userId: user.id, name, relation: 'SELF', age: 30, gender: 'F' } });
    }

    async function scenario() {
        const drA = await makeDoctor();
        await testDb.doctorProfile.update({ where: { id: drA.profile.id }, data: { displayName: 'Dr Asha' } });
        const drB = await makeDoctor();
        await testDb.doctorProfile.update({ where: { id: drB.profile.id }, data: { displayName: 'Dr Bharat' } });
        const p1 = await person('Priya');
        const p2 = await person('Ravi');
        const c = {
            onTime: await booking({ doctor: drA, patient: p1, daysAgo: 6, status: 'COMPLETED', doctorJoinMin: 2, patientJoinMin: 1 }),
            bothLate: await booking({ doctor: drA, patient: p1, daysAgo: 5, status: 'COMPLETED', doctorJoinMin: 8, patientJoinMin: 12 }),
            patientNoShow: await booking({ doctor: drA, patient: p2, daysAgo: 4, status: 'NO_SHOW_PATIENT', doctorJoinMin: 0 }),
            doctorNoShow: await booking({ doctor: drB, patient: p2, daysAgo: 3, status: 'NO_SHOW_DOCTOR', patientJoinMin: 0 }),
            // A doctor no-show whose refund went through: the status moved on to REFUNDED.
            refundedNoShow: await booking({ doctor: drB, patient: p1, daysAgo: 2, status: 'REFUNDED', doctorNoShowRefund: true }),
            // Not due: cancelled in time, upcoming, and outside the default 30 days.
            cancelled: await booking({ doctor: drB, patient: p1, daysAgo: 1, status: 'CANCELLED' }),
            upcoming: await booking({ doctor: drA, patient: p2, daysAgo: -1, status: 'CONFIRMED' }),
            old: await booking({ doctor: drA, patient: p1, daysAgo: 40, status: 'NO_SHOW_DOCTOR' }),
        };
        return { drA, drB, p1, p2, c };
    }

    it('counts due consultations only, with no-shows and late joins per side', async () => {
        await scenario();
        const { status, body } = await getJson(`${app.url}/manager/consult/attendance`, managerToken);
        expect(status).toBe(200);
        expect(body.lateAfterMinutes).toBe(5);
        expect(body.truncated).toBe(false);
        expect(body.totals).toEqual({
            consultations: 5,
            doctor: { consultations: 5, noShows: 2, late: 1, avgMinutesLate: 8 },
            patient: { consultations: 5, noShows: 1, late: 1, avgMinutesLate: 12 },
        });
    });

    it('lists every doctor (worst first) and only the patients who missed or were late', async () => {
        const { drA, drB, p1, p2 } = await scenario();
        const { body } = await getJson(`${app.url}/manager/consult/attendance`, managerToken);
        expect(body.doctors).toEqual([
            { doctorId: drB.profile.id, name: 'Dr Bharat', consultations: 2, noShows: 2, late: 0, avgMinutesLate: null },
            { doctorId: drA.profile.id, name: 'Dr Asha', consultations: 3, noShows: 0, late: 1, avgMinutesLate: 8 },
        ]);
        const mobileOf = async (p: { userId: string }) => (await testDb.user.findUniqueOrThrow({ where: { id: p.userId } })).mobile;
        expect(body.patients).toEqual([
            { patientId: p2.id, name: 'Ravi', mobile: await mobileOf(p2), consultations: 2, noShows: 1, late: 0, avgMinutesLate: null },
            { patientId: p1.id, name: 'Priya', mobile: await mobileOf(p1), consultations: 3, noShows: 0, late: 1, avgMinutesLate: 12 },
        ]);
    });

    it('lists each consultation with a problem, newest first, with both sides', async () => {
        const { c } = await scenario();
        const { body } = await getJson(`${app.url}/manager/consult/attendance`, managerToken);
        expect(body.issues.map((r: { consultationId: string }) => r.consultationId)).toEqual([c.refundedNoShow.id, c.doctorNoShow.id, c.patientNoShow.id, c.bothLate.id]);
        const late = body.issues[3];
        expect(late).toMatchObject({ doctorName: 'Dr Asha', patientName: 'Priya', status: 'COMPLETED' });
        expect(late.doctor).toMatchObject({ outcome: 'LATE', minutesLate: 8 });
        expect(late.patient).toMatchObject({ outcome: 'LATE', minutesLate: 12 });
        expect(body.issues[1].patient.outcome).toBe('ON_TIME');
    });

    it('takes a date range in IST days', async () => {
        const { c } = await scenario();
        const { body } = await getJson(`${app.url}/manager/consult/attendance?from=${istDay(45)}&to=${istDay(35)}`, managerToken);
        expect(body.totals.consultations).toBe(1);
        expect(body.issues.map((r: { consultationId: string }) => r.consultationId)).toEqual([c.old.id]);

        for (const [query, error] of [['from=2026-11-02&to=2026-11-01', 'The start date must be on or before the end date'], ['from=1-2-2026', 'Dates must be YYYY-MM-DD']]) {
            const res = await getJson(`${app.url}/manager/consult/attendance?${query}`, managerToken);
            expect(res).toEqual({ status: 400, body: { error } });
        }
    });

    it('shows no number for a deleted account', async () => {
        const dr = await makeDoctor();
        const p = await person('Gone');
        await testDb.user.update({ where: { id: p.userId }, data: { mobile: `deleted:${p.userId}` } });
        await booking({ doctor: dr, patient: p, daysAgo: 2, status: 'NO_SHOW_PATIENT', doctorJoinMin: 0 });
        const { body } = await getJson(`${app.url}/manager/consult/attendance`, managerToken);
        expect(body.patients[0]).toMatchObject({ name: 'Gone', mobile: null });
    });

    it('exports the problem list as CSV, with formulas in names made harmless', async () => {
        const { p1 } = await scenario();
        await testDb.patient.update({ where: { id: p1.id }, data: { name: '=HYPERLINK("http://x")' } });
        const [from, to] = [istDay(60), istDay(0)];
        const res = await fetch(`${app.url}/manager/consult/attendance.csv?from=${from}&to=${to}`, { headers: { authorization: `Bearer ${managerToken}` } });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(res.headers.get('content-disposition')).toBe(`attachment; filename="consult-no-shows-${from}-to-${to}.csv"`);
        const lines = (await res.text()).replace(/^﻿/, '').split('\r\n');
        expect(lines[0]).toContain('"Doctor attendance"');
        expect(lines).toHaveLength(1 + 5); // header + the four in the last 30 days + the 40-day-old one
        expect(lines.some((l) => l.includes('"\'=HYPERLINK(""http://x"")"'))).toBe(true);
        expect(lines.some((l) => l.includes('"Late","') && l.includes('"8"') && l.includes('"12"'))).toBe(true);
    });

    it('is for managers and super admins only', async () => {
        const url = `${app.url}/manager/consult/attendance`;
        expect((await getJson(url)).status).toBe(401);
        expect((await getJson(url, tokenFor(await makeUser()))).status).toBe(403);
        expect((await getJson(url, tokenFor((await makeDoctor()).user))).status).toBe(403);
        expect((await getJson(url, tokenFor(await makeUser('SUPER_ADMIN')))).status).toBe(200);
        expect((await getJson(`${app.url}/manager/consult/attendance.csv`, tokenFor(await makeUser()))).status).toBe(403);
    });
});
