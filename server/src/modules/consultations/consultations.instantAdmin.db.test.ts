/**
 * P10c: super admin "Online now" (real Postgres). Read-only views of instant consults: online GPs with
 * the matcher's own states, live requests without patient details, a logged request detail, recent
 * outcomes, and online hours per IST day (the query P13 payroll will reuse).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

const MIN = 60_000;
const HOUR = 60 * MIN;

describeDb('instant consults: admin Online now (real Postgres)', () => {
    let instant: typeof import('./consultations.instant');
    let adminView: typeof import('./consultations.instantAdmin');
    let hours: typeof import('./consultations.presenceHours');
    let adminApp: { url: string; close: () => Promise<void> };
    let gp: { id: string };

    beforeAll(async () => {
        instant = await import('./consultations.instant');
        adminView = await import('./consultations.instantAdmin');
        hours = await import('./consultations.presenceHours');
        const doctors = await import('./doctors.routes');
        adminApp = await serve('/admin/consult', doctors.consultAdminRoutes);
        gp = await testDb.specialty.upsert({ where: { name: 'General Physician' }, update: { slug: 'general-physician', isActive: true }, create: { name: 'General Physician', slug: 'general-physician' } });
    });
    afterAll(async () => {
        await adminApp?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        await testDb.adminAuditLog.deleteMany({ where: { action: 'INSTANT_REQUEST_VIEW' } });
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    const db = () => testDb;
    const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

    async function call(path: string, user?: { id: string }) {
        const headers: Record<string, string> = {};
        if (user) headers.authorization = `Bearer ${tokenFor(await testDb.user.findUniqueOrThrow({ where: { id: user.id } }))}`;
        const res = await fetch(`${adminApp.url}/admin/consult/instant${path}`, { headers });
        return { status: res.status, body: await res.json().catch(() => null) };
    }

    async function onlineGp(now: Date, name = 'Dr GP') {
        const d = await makeDoctor();
        await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { specialtyId: gp.id, displayName: name } });
        await instant.goOnline(d.profile.id, { db: db(), now });
        return d;
    }
    async function asker() {
        const user = await makeUser();
        const patient = await makePatient(user.id);
        return { user, patient };
    }
    const start = (p: { user: { id: string }; patient: { id: string } }, now: Date) =>
        instant.startInstant({ userId: p.user.id, patientId: p.patient.id, reason: 'Fever since yesterday' }, { db: db(), now });
    const stateOf = (v: Awaited<ReturnType<typeof adminView.onlineNow>>, doctorId: string) => v.doctors.find((d) => d.doctorId === doctorId)?.state;

    // ── Access ──

    it('lets only super admins read any of it (doctor and patient 403, anonymous 401)', async () => {
        const now = new Date();
        await onlineGp(now);
        const p = await asker();
        const req = await start(p, now);
        const doctor = await makeDoctor();
        const superAdmin = await makeUser('SUPER_ADMIN');
        const paths = ['/live', `/requests/${req.id}`, '/outcomes', '/presence'];
        for (const path of paths) {
            expect((await call(path)).status, path).toBe(401);
            expect((await call(path, p.user)).status, path).toBe(403);
            expect((await call(path, doctor.user)).status, path).toBe(403);
            expect((await call(path, superAdmin)).status, path).toBe(200);
        }
    });

    // ── Online now: the matcher's states ──

    it('labels each online GP free, ringing, waiting for payment, in a call or consult due soon, as the matcher sees them', async () => {
        const now = new Date();
        const free = await onlineGp(now, 'Dr Free');
        const ringing = await onlineGp(now, 'Dr Ringing');
        const accepted = await onlineGp(now, 'Dr Accepted');
        const inCall = await onlineGp(now, 'Dr In Call');
        const dueSoon = await onlineGp(now, 'Dr Due Soon');
        const notGp = await makeDoctor(); // online but not a GP: not an instant doctor, not listed
        await testDb.doctorPresence.create({ data: { doctorId: notGp.profile.id, startedAt: now, lastSeenAt: now } });

        // A call in progress and a booked consult in 10 minutes, made straight in the DB.
        const u = await makeUser();
        const pt = await makePatient(u.id);
        const s1 = await makeSlot(inCall.profile.id, -5, 'BOOKED');
        await makeConsultation({ userId: u.id, patientId: pt.id, doctorId: inCall.profile.id, slotId: s1.id, startsAt: s1.startsAt, status: 'IN_PROGRESS' });
        const s2 = await makeSlot(dueSoon.profile.id, 10, 'BOOKED');
        await makeConsultation({ userId: u.id, patientId: pt.id, doctorId: dueSoon.profile.id, slotId: s2.id, startsAt: s2.startsAt, status: 'CONFIRMED' });

        // Two requests: rung in online order (free, ringing, accepted first). Make the first two ring
        // "Dr Ringing" and "Dr Accepted" by taking "Dr Free" offline while they are asked.
        await instant.goOffline(free.profile.id, { db: db(), now });
        const a = await start(await asker(), at(now, 1000));
        const b = await start(await asker(), at(now, 2000));
        const ra = await testDb.instantRequest.findUniqueOrThrow({ where: { id: a.id } });
        const rb = await testDb.instantRequest.findUniqueOrThrow({ where: { id: b.id } });
        expect([ra.doctorId, rb.doctorId].sort()).toEqual([ringing.profile.id, accepted.profile.id].sort());
        const acceptReq = ra.doctorId === accepted.profile.id ? ra : rb;
        await instant.acceptInstant(accepted.profile.id, acceptReq.id, { db: db(), now: at(now, 3000) });
        await instant.goOnline(free.profile.id, { db: db(), now: at(now, 4000) });

        const view = await adminView.onlineNow({ db: db(), now: at(now, 5000) });
        expect(stateOf(view, free.profile.id)).toBe('FREE');
        expect(stateOf(view, ringing.profile.id)).toBe('RINGING');
        expect(stateOf(view, accepted.profile.id)).toBe('WAITING_PAYMENT');
        expect(stateOf(view, inCall.profile.id)).toBe('IN_CALL');
        expect(stateOf(view, dueSoon.profile.id)).toBe('SCHEDULED_SOON');
        expect(view.doctors.map((d) => d.doctorId)).not.toContain(notGp.profile.id);
        expect(view.online).toBe(5);

        // The same rules as the matcher: FREE here is exactly the set it would ring.
        const ringable = await instant.freeOnlineDoctorIds(db(), at(now, 5000));
        expect([...ringable].sort()).toEqual(view.doctors.filter((d) => d.state === 'FREE').map((d) => d.doctorId).sort());
        expect(view.free).toBe(ringable.size);
    });

    it('drops a doctor whose panel went quiet, as the matcher does', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        expect((await adminView.onlineNow({ db: db(), now: at(now, 30_000) })).doctors[0]).toMatchObject({ doctorId: d.profile.id, onlineSeconds: 30 });
        expect((await adminView.onlineNow({ db: db(), now: at(now, 61_000) })).online).toBe(0);
    });

    // ── Live requests and the logged detail ──

    it('lists live requests without patient name or reason; opening one shows them and is logged', async () => {
        const now = new Date();
        const doc = await onlineGp(now, 'Dr Anil');
        const p = await asker();
        await testDb.patient.update({ where: { id: p.patient.id }, data: { name: 'Kamla Devi', dob: new Date('1960-01-15'), gender: 'F' } });
        const req = await start(p, now);
        const superAdmin = await makeUser('SUPER_ADMIN');

        const live = await call('/live', superAdmin);
        expect(live.status).toBe(200);
        const text = JSON.stringify(live.body);
        expect(text).not.toContain('Kamla');
        expect(text).not.toContain('Fever');
        expect(live.body.waitingTotal).toBe(1);
        expect(live.body.requests).toEqual([expect.objectContaining({ id: req.id, status: 'RINGING', doctorsTried: 1, doctor: { id: doc.profile.id, name: 'Dr Anil' } })]);
        expect(await testDb.adminAuditLog.count({ where: { action: 'INSTANT_REQUEST_VIEW' } })).toBe(0);

        const detail = await call(`/requests/${req.id}`, superAdmin);
        expect(detail.status).toBe(200);
        expect(detail.body).toMatchObject({ reason: 'Fever since yesterday', patient: { name: 'Kamla Devi', gender: 'F' } });
        expect(detail.body.patient.age).toBeGreaterThanOrEqual(66);
        const log = await testDb.adminAuditLog.findFirstOrThrow({ where: { action: 'INSTANT_REQUEST_VIEW' } });
        expect(log).toMatchObject({ adminId: superAdmin.id, entity: 'InstantRequest', targetId: req.id, newValue: { patientId: p.patient.id } });

        expect((await call('/requests/00000000-0000-4000-8000-000000000000', superAdmin)).status).toBe(404);
        expect((await call('/requests/not-a-uuid', superAdmin)).status).toBe(404);
    });

    it('names the doctors a request passed by, in order', async () => {
        const now = new Date();
        const first = await onlineGp(now, 'Dr First');
        await onlineGp(now, 'Dr Second');
        const req = await start(await asker(), now);
        expect((await testDb.instantRequest.findUniqueOrThrow({ where: { id: req.id } })).doctorId).toBe(first.profile.id);
        await instant.declineInstant(first.profile.id, req.id, { db: db(), now: at(now, 1000) });
        await instant.advanceInstant({ db: db(), now: at(now, 2000) });
        const d = await adminView.instantRequestDetail({ adminId: (await makeUser('SUPER_ADMIN')).id, adminName: 'A' }, req.id, { db: db(), now: at(now, 3000) });
        expect(d.passedBy).toEqual([{ id: first.profile.id, name: 'Dr First' }]);
        expect(d.doctor?.name).toBe('Dr Second');
        expect(d.doctorsTried).toBe(2);
    });

    // ── Recent outcomes ──

    it('counts no doctor found, doctors switched offline after missed rings, and keeps older ones out of 24 h', async () => {
        const now = new Date();
        // A doctor misses two rings in a row and is switched offline.
        const d = await onlineGp(now, 'Dr Sleepy');
        const r1 = await start(await asker(), now);
        await testDb.doctorPresence.updateMany({ where: { doctorId: d.profile.id, endedAt: null }, data: { lastSeenAt: at(now, 61_000) } });
        await instant.advanceInstant({ db: db(), now: at(now, 61_000) });
        const r2 = await start(await asker(), at(now, 62_000));
        expect((await testDb.instantRequest.findUniqueOrThrow({ where: { id: r2.id } })).doctorId).toBe(d.profile.id);
        await testDb.doctorPresence.updateMany({ where: { doctorId: d.profile.id, endedAt: null }, data: { lastSeenAt: at(now, 123_000) } });
        await instant.advanceInstant({ db: db(), now: at(now, 123_000) });
        expect(await testDb.doctorPresence.findFirstOrThrow({ where: { doctorId: d.profile.id } })).toMatchObject({ endReason: 'MISSED_RINGS' });

        // Both searches run out with nobody else online.
        await instant.advanceInstant({ db: db(), now: at(now, 12 * MIN) });
        expect((await testDb.instantRequest.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe('NO_MATCH');

        // One older no-match, 3 days ago: in 7 days, not in 24 h.
        const old = await asker();
        await testDb.instantRequest.create({ data: { userId: old.user.id, patientId: old.patient.id, reason: 'Old', status: 'NO_MATCH', searchEndsAt: at(now, -3 * 24 * HOUR), endedAt: at(now, -3 * 24 * HOUR) } });

        const day = await adminView.instantOutcomes('24h', { db: db(), now: at(now, 13 * MIN) });
        expect(day.counts).toMatchObject({ noDoctorFound: 2, switchedOfflineMissedRings: 1, booked: 0, latePaymentsRefunded: 0 });
        expect(day.switchedOffline[0]).toMatchObject({ doctorId: d.profile.id, doctorName: 'Dr Sleepy' });
        const week = await adminView.instantOutcomes('7d', { db: db(), now: at(now, 13 * MIN) });
        expect(week.counts.noDoctorFound).toBe(3);

        const superAdmin = await makeUser('SUPER_ADMIN');
        expect((await call('/outcomes?window=30d', superAdmin)).status).toBe(400);
    });

    it('counts late payments refunded on instant bookings only', async () => {
        const now = new Date();
        const d = await makeDoctor();
        const u = await makeUser();
        const pt = await makePatient(u.id);
        async function lateRefund(isInstant: boolean) {
            const slot = await makeSlot(d.profile.id, 60);
            const c = await makeConsultation({ userId: u.id, patientId: pt.id, doctorId: d.profile.id, slotId: slot.id, startsAt: slot.startsAt, status: 'EXPIRED' });
            await testDb.consultation.update({ where: { id: c.id }, data: { isInstant } });
            const pay = await testDb.consultationPayment.create({ data: { consultationId: c.id, razorpayOrderId: `order_${c.id.slice(0, 8)}`, amountPaise: 35000, status: 'CAPTURED', capturedAt: now } });
            return testDb.consultationRefund.create({ data: { consultationId: c.id, paymentId: pay.id, reason: 'LATE_PAYMENT_SLOT_LOST', amountPaise: 35000, receipt: `r_${pay.id.slice(0, 20)}` } });
        }
        const instantRefund = await lateRefund(true);
        await lateRefund(false);
        const out = await adminView.instantOutcomes('24h', { db: db(), now: at(now, 1000) });
        expect(out.counts.latePaymentsRefunded).toBe(1);
        expect(out.lateRefunds).toEqual([expect.objectContaining({ id: instantRefund.id, amountPaise: 35000 })]);
    });

    // ── Presence hours per IST day ──

    describe('presence hours', () => {
        // 2026-11-20 23:00 IST = 17:30 UTC.
        const ist = (day: string, hhmm: string) => new Date(Date.parse(`${day}T${hhmm}:00+05:30`));

        async function session(doctorId: string, startedAt: Date, endedAt: Date | null, lastSeenAt?: Date) {
            return testDb.doctorPresence.create({ data: { doctorId, startedAt, endedAt, lastSeenAt: lastSeenAt ?? endedAt ?? startedAt, endReason: endedAt ? 'OFF' : null } });
        }

        it('splits a session across IST midnight', async () => {
            const d = await onlineGp(ist('2026-11-01', '09:00')); // an unrelated session outside the range
            await session(d.profile.id, ist('2026-11-20', '23:00'), ist('2026-11-21', '01:30'));
            const [row] = await hours.presenceHours(db(), { fromDay: '2026-11-20', toDay: '2026-11-21', now: ist('2026-11-24', '12:00') });
            expect(row.days).toEqual([
                { day: '2026-11-20', seconds: 3600, sessions: 1 },
                { day: '2026-11-21', seconds: 5400, sessions: 1 },
            ]);
            expect(row.totalSeconds).toBe(9000);
            // Only the second day asked: only its part counts.
            const [only21] = await hours.presenceHours(db(), { fromDay: '2026-11-21', toDay: '2026-11-21', now: ist('2026-11-24', '12:00') });
            expect(only21.totalSeconds).toBe(5400);
        });

        it('counts an open session up to now while the panel checks in, and only to its last check-in once quiet', async () => {
            const d = await makeDoctor();
            const now = ist('2026-11-24', '10:00');
            await session(d.profile.id, ist('2026-11-24', '08:00'), null, at(now, -10_000)); // checked in 10 s ago
            const [live] = await hours.presenceHours(db(), { fromDay: '2026-11-24', toDay: '2026-11-24', now });
            expect(live.totalSeconds).toBe(2 * 3600);
            expect(live.sessions[0]).toMatchObject({ open: true });

            await testDb.doctorPresence.updateMany({ where: { doctorId: d.profile.id }, data: { lastSeenAt: ist('2026-11-24', '09:00') } });
            const [quiet] = await hours.presenceHours(db(), { fromDay: '2026-11-24', toDay: '2026-11-24', now });
            expect(quiet.totalSeconds).toBe(3600);
        });

        it('adds several sessions on a day, filters by doctor, and checks the range', async () => {
            const a = await makeDoctor();
            const b = await makeDoctor();
            await session(a.profile.id, ist('2026-11-22', '09:00'), ist('2026-11-22', '10:00'));
            await session(a.profile.id, ist('2026-11-22', '14:00'), ist('2026-11-22', '14:30'));
            await session(b.profile.id, ist('2026-11-22', '09:00'), ist('2026-11-22', '09:15'));
            const now = ist('2026-11-24', '12:00');
            const all = await hours.presenceHours(db(), { fromDay: '2026-11-22', toDay: '2026-11-22', now });
            expect(all.map((r) => [r.doctorId, r.totalSeconds])).toEqual([[a.profile.id, 5400], [b.profile.id, 900]]);
            expect(all[0].days).toEqual([{ day: '2026-11-22', seconds: 5400, sessions: 2 }]);
            const onlyB = await hours.presenceHours(db(), { fromDay: '2026-11-22', toDay: '2026-11-22', doctorIds: [b.profile.id], now });
            expect(onlyB.map((r) => r.doctorId)).toEqual([b.profile.id]);

            expect(() => hours.presenceRange('2026-11-23', '2026-11-22')).toThrow(hours.PresenceRangeError);
            expect(() => hours.presenceRange('2026-02-30', '2026-03-01')).toThrow(hours.PresenceRangeError);
            expect(() => hours.presenceRange('2026-01-01', '2026-12-31')).toThrow(hours.PresenceRangeError);
            expect(() => hours.presenceRange('2026-13-01', '2026-13-05')).toThrow(hours.PresenceRangeError);

            const superAdmin = await makeUser('SUPER_ADMIN');
            const res = await call(`/presence?from=2026-11-22&to=2026-11-22&doctorId=${a.profile.id}`, superAdmin);
            expect(res.status).toBe(200);
            expect(res.body.doctors).toEqual([expect.objectContaining({ doctorId: a.profile.id, totalSeconds: 5400 })]);
            expect((await call('/presence?from=2026-11-23&to=2026-11-22', superAdmin)).status).toBe(400);
            expect((await call('/presence?from=2026-13-01&to=2026-13-05', superAdmin)).status).toBe(400);
        });
    });
});
