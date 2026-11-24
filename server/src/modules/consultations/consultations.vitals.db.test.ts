/**
 * P8: vitals tracker (real Postgres). Rules (Aditya, 2026-11-24): readings and period logs per person,
 * only the owning account manages them; impossible values are refused; a next-period estimate; doctors
 * see vitals only through P7 sharing (opt-in per booking, until 7 days after, every view logged).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

const DAY = 86_400_000;

describeDb('vitals tracker (real Postgres)', () => {
    let vitals: typeof import('./consultations.vitals');
    let records: typeof import('./consultations.records');
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let razorpay: FakeRazorpay;
    let app: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        vitals = await import('./consultations.vitals');
        records = await import('./consultations.records');
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        const routes = await import('./consultations.routes');
        app = await serve('/consult', routes.consultPatientRoutes);
    });
    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    const asUser = (u: { id: string }) => testDb.user.findUniqueOrThrow({ where: { id: u.id } });
    async function call(method: string, path: string, user: { id: string }, body?: unknown) {
        const res = await fetch(`${app.url}/consult${path}`, {
            method,
            headers: { authorization: `Bearer ${tokenFor(await asUser(user))}`, ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json() };
    }
    const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
    const dayAgo = (days: number) => vitals.istDay(new Date(Date.now() - days * DAY));

    let n = 0;
    async function paidBooking(opts: { shareRecord: boolean; user: { id: string }; patient: { id: string }; version?: string }) {
        const doctor = await makeDoctor();
        const slot = await makeSlot(doctor.profile.id, 30 * 60);
        const res = await booking.createBooking(
            { userId: opts.user.id, patientId: opts.patient.id, slotId: slot.id, idempotencyKey: `key-vit-${++n}-12345`, shareRecord: opts.shareRecord, shareMeta: { channel: 'web', version: opts.version ?? 'record-share-v2' } },
            { razorpay },
        );
        await payments.confirmPayment({ paymentId: `pay_vit${String(++n).padStart(9, '0')}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
        return { doctor, id: res.consultationId, slot };
    }

    describe('readings', () => {
        it('the owner adds BP and sugar readings per person; lists are per kind, newest first, within the range', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const mum = await makePatient(user.id);
            expect((await call('POST', `/vitals/${self.id}/readings`, user, { kind: 'BP', systolic: 128, diastolic: 84, pulse: 72, measuredAt: ago(1) })).status).toBe(201);
            expect((await call('POST', `/vitals/${self.id}/readings`, user, { kind: 'BP', systolic: 135, diastolic: 88, measuredAt: ago(0.1), note: 'after a walk' })).status).toBe(201);
            expect((await call('POST', `/vitals/${self.id}/readings`, user, { kind: 'BP', systolic: 140, diastolic: 90, measuredAt: ago(100) })).status).toBe(201);
            expect((await call('POST', `/vitals/${self.id}/readings`, user, { kind: 'SUGAR', glucoseMgDl: 104, sugarTiming: 'FASTING', measuredAt: ago(2) })).status).toBe(201);
            expect((await call('POST', `/vitals/${mum.id}/readings`, user, { kind: 'SUGAR', glucoseMgDl: 180, sugarTiming: 'AFTER_MEAL', measuredAt: ago(2) })).status).toBe(201);

            const bp = await call('GET', `/vitals/${self.id}/readings?kind=BP&days=90`, user);
            expect(bp.status).toBe(200);
            expect(bp.body.readings.map((r: { systolic: number }) => r.systolic)).toEqual([135, 128]);
            expect(bp.body.readings[0]).toMatchObject({ kind: 'BP', diastolic: 88, pulse: null, note: 'after a walk', glucoseMgDl: null, source: 'MANUAL' });
            expect((await call('GET', `/vitals/${self.id}/readings?kind=BP&days=365`, user)).body.total).toBe(3);
            const sugar = await call('GET', `/vitals/${self.id}/readings?kind=SUGAR`, user);
            expect(sugar.body).toMatchObject({ days: 90, total: 1, readings: [{ glucoseMgDl: 104, sugarTiming: 'FASTING' }] });
            expect((await call('GET', `/vitals/${mum.id}/readings?kind=SUGAR`, user)).body.readings).toHaveLength(1);
            expect((await call('GET', `/vitals/${self.id}/readings?kind=WEIGHT`, user)).status).toBe(400);
            expect((await call('GET', `/vitals/${self.id}/readings?kind=BP&days=7`, user)).status).toBe(400);
        });

        it('refuses impossible values and a future time; nothing is stored', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const post = (body: object) => call('POST', `/vitals/${self.id}/readings`, user, body);
            expect(await post({ kind: 'BP', systolic: 80, diastolic: 120, measuredAt: ago(0) })).toEqual({ status: 400, body: { error: 'The upper number must be higher than the lower one' } });
            expect((await post({ kind: 'BP', systolic: 900, diastolic: 80, measuredAt: ago(0) })).status).toBe(400);
            expect((await post({ kind: 'SUGAR', glucoseMgDl: 4000, sugarTiming: 'RANDOM', measuredAt: ago(0) })).status).toBe(400);
            expect((await post({ kind: 'SUGAR', glucoseMgDl: 100, measuredAt: ago(0) })).status).toBe(400);
            expect(await post({ kind: 'BP', systolic: 120, diastolic: 80, measuredAt: ago(-1) })).toEqual({ status: 400, body: { error: 'The time of a reading cannot be in the future' } });
            expect(await testDb.vitalReading.count({ where: { userId: user.id } })).toBe(0);
        });

        it('the database refuses a reading with the wrong values for its kind, even past the app', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const base = { userId: user.id, patientId: self.id, measuredAt: new Date() };
            await expect(testDb.vitalReading.create({ data: { ...base, kind: 'BP', systolic: 80, diastolic: 120 } })).rejects.toThrow();
            await expect(testDb.vitalReading.create({ data: { ...base, kind: 'SUGAR', glucoseMgDl: 100, sugarTiming: 'RANDOM', systolic: 120 } })).rejects.toThrow();
            await expect(testDb.vitalReading.create({ data: { ...base, kind: 'WEIGHT' } })).rejects.toThrow();
            // Missing values: a CHECK that is NULL would pass, so each value is tested for presence.
            await expect(testDb.vitalReading.create({ data: { ...base, kind: 'BP' } })).rejects.toThrow();
            await expect(testDb.vitalReading.create({ data: { ...base, kind: 'BP', systolic: 120 } })).rejects.toThrow();
            await expect(testDb.vitalReading.create({ data: { ...base, kind: 'SUGAR', glucoseMgDl: 100 } })).rejects.toThrow();
            await expect(testDb.vitalReading.create({ data: { ...base, kind: 'SUGAR' } })).rejects.toThrow();
            await expect(testDb.periodLog.create({ data: { userId: user.id, patientId: self.id, startDate: new Date('2026-11-10'), endDate: new Date('2026-11-09') } })).rejects.toThrow();
        });

        it('another account cannot list, add or delete someone\'s readings (404)', async () => {
            const owner = await makeUser();
            const self = await makePatient(owner.id);
            const stranger = await makeUser();
            const r = await call('POST', `/vitals/${self.id}/readings`, owner, { kind: 'BP', systolic: 120, diastolic: 80, measuredAt: ago(0) });
            expect((await call('GET', `/vitals/${self.id}/readings?kind=BP`, stranger)).status).toBe(404);
            expect((await call('POST', `/vitals/${self.id}/readings`, stranger, { kind: 'BP', systolic: 120, diastolic: 80, measuredAt: ago(0) })).status).toBe(404);
            expect((await call('DELETE', `/vitals/readings/${r.body.id}`, stranger)).status).toBe(404);
            expect((await call('GET', `/vitals/${self.id}/periods`, stranger)).status).toBe(404);
            expect((await call('GET', `/vitals/not-a-uuid/periods`, stranger)).status).toBe(404);
            expect(await testDb.vitalReading.count({ where: { patientId: self.id } })).toBe(1);
            expect((await call('DELETE', `/vitals/readings/${r.body.id}`, owner)).status).toBe(200);
            expect(await testDb.vitalReading.count({ where: { patientId: self.id } })).toBe(0);
        });

        it('a family member who accepted the phone link still cannot manage the vitals (owner only, like the vault)', async () => {
            const owner = await makeUser();
            const relative = await makeUser();
            const mum = await makePatient(owner.id);
            await testDb.patient.update({ where: { id: mum.id }, data: { linkedUserId: relative.id, linkedAt: new Date() } });
            expect((await call('GET', `/vitals/${mum.id}/periods`, relative)).status).toBe(404);
        });
    });

    describe('periods', () => {
        it('logs a period, ends it later, and gives an estimate once there are two cycles', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const post = (body: object) => call('POST', `/vitals/${self.id}/periods`, user, body);
            expect((await post({ startDate: dayAgo(60), endDate: dayAgo(56), flow: 'MEDIUM', symptoms: ['CRAMPS', 'CRAMPS', 'FATIGUE'] })).status).toBe(201);
            let list = await call('GET', `/vitals/${self.id}/periods`, user);
            expect(list.body.estimate).toBeNull();
            expect(list.body.logs[0]).toMatchObject({ startDate: dayAgo(60), endDate: dayAgo(56), flow: 'MEDIUM', symptoms: ['CRAMPS', 'FATIGUE'] });

            expect((await post({ startDate: dayAgo(32), endDate: dayAgo(28) })).status).toBe(201);
            const open = await post({ startDate: dayAgo(2) });
            expect(open.status).toBe(201);
            expect(open.body.endDate).toBeNull();

            list = await call('GET', `/vitals/${self.id}/periods`, user);
            expect(list.body.logs.map((l: { startDate: string }) => l.startDate)).toEqual([dayAgo(2), dayAgo(32), dayAgo(60)]);
            expect(list.body.estimate).toEqual({ nextStart: vitals.istDay(new Date(Date.now() + 27 * DAY)), averageCycleDays: 29, cyclesUsed: 2, passed: false });

            const ended = await call('PATCH', `/vitals/periods/${open.body.id}`, user, { endDate: dayAgo(0) });
            expect(ended.status).toBe(200);
            // Only the end date changed.
            expect(ended.body).toMatchObject({ startDate: dayAgo(2), endDate: dayAgo(0), flow: null, symptoms: [] });
        });

        it('refuses overlapping logs, a period still going counting up to today; edits are checked the same way', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const post = (body: object) => call('POST', `/vitals/${self.id}/periods`, user, body);
            const first = await post({ startDate: dayAgo(40), endDate: dayAgo(36) });
            expect((await post({ startDate: dayAgo(38) })).status).toBe(409);
            expect((await post({ startDate: dayAgo(45), endDate: dayAgo(40) })).status).toBe(409);
            expect((await post({ startDate: dayAgo(35), endDate: dayAgo(33) })).status).toBe(201);
            expect((await post({ startDate: dayAgo(4) })).status).toBe(201);
            const clash = await post({ startDate: dayAgo(1) });
            expect(clash).toEqual({ status: 409, body: { error: `This overlaps the period logged from ${dayAgo(4)}. Edit that one instead.` } });
            // Moving the first log onto the second one is refused too; the same start twice is a clash, not a 500.
            expect((await call('PATCH', `/vitals/periods/${first.body.id}`, user, { endDate: dayAgo(34) })).status).toBe(409);
            expect((await post({ startDate: dayAgo(40), endDate: dayAgo(40) })).status).toBe(409);
            expect((await call('PATCH', `/vitals/periods/${first.body.id}`, user, { endDate: dayAgo(25) })).status).toBe(400);
        });

        it('two saves at once cannot leave overlapping logs', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const results = await Promise.allSettled([
                vitals.addPeriod(user.id, self.id, { startDate: dayAgo(10), endDate: dayAgo(6) }),
                vitals.addPeriod(user.id, self.id, { startDate: dayAgo(8), endDate: dayAgo(4) }),
                vitals.addPeriod(user.id, self.id, { startDate: dayAgo(9) }),
            ]);
            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            expect(await testDb.periodLog.count({ where: { patientId: self.id } })).toBe(1);
        });

        it('two partial edits at once both stick; an edit of a deleted log is a 404, not a 500', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const log = await vitals.addPeriod(user.id, self.id, { startDate: dayAgo(3) });
            await Promise.all([
                vitals.editPeriod(user.id, log.id, { symptoms: ['CRAMPS'] }),
                vitals.editPeriod(user.id, log.id, { endDate: dayAgo(1) }),
                vitals.editPeriod(user.id, log.id, { flow: 'LIGHT' }),
            ]);
            const row = await testDb.periodLog.findUniqueOrThrow({ where: { id: log.id } });
            expect({ symptoms: row.symptoms, flow: row.flow, ended: !!row.endDate }).toEqual({ symptoms: ['CRAMPS'], flow: 'LIGHT', ended: true });
            const results = await Promise.allSettled([vitals.removePeriod(user.id, log.id), vitals.editPeriod(user.id, log.id, { flow: 'HEAVY' })]);
            for (const r of results) if (r.status === 'rejected') expect((r.reason as { status?: number }).status).toBe(404);
        });

        it('only the owner edits or deletes a log', async () => {
            const owner = await makeUser();
            const self = await makePatient(owner.id);
            const stranger = await makeUser();
            const log = await vitals.addPeriod(owner.id, self.id, { startDate: dayAgo(3) });
            expect((await call('PATCH', `/vitals/periods/${log.id}`, stranger, { endDate: dayAgo(1) })).status).toBe(404);
            expect((await call('DELETE', `/vitals/periods/${log.id}`, stranger)).status).toBe(404);
            expect((await call('DELETE', `/vitals/periods/${log.id}`, owner)).status).toBe(200);
            expect(await testDb.periodLog.count({ where: { patientId: self.id } })).toBe(0);
        });
    });

    describe('who else sees them', () => {
        async function withVitals() {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const sibling = await makePatient(user.id);
            await vitals.addReading(user.id, self.id, { kind: 'BP', systolic: 130, diastolic: 85, measuredAt: new Date(Date.now() - DAY), note: null });
            await vitals.addReading(user.id, self.id, { kind: 'BP', systolic: 150, diastolic: 95, measuredAt: new Date(Date.now() - 200 * DAY), note: null });
            await vitals.addReading(user.id, self.id, { kind: 'SUGAR', glucoseMgDl: 140, sugarTiming: 'RANDOM', measuredAt: new Date(Date.now() - 2 * DAY), note: null });
            await vitals.addReading(user.id, sibling.id, { kind: 'BP', systolic: 110, diastolic: 70, measuredAt: new Date(), note: null });
            for (const d of [60, 32, 4]) await vitals.addPeriod(user.id, self.id, { startDate: dayAgo(d), endDate: dayAgo(d - 3) });
            return { user, self, sibling };
        }

        it('the doctor of a shared booking sees this person\'s last 180 days and periods with the estimate, under one log row', async () => {
            const { user, self } = await withVitals();
            const b = await paidBooking({ shareRecord: true, user, patient: self });
            const out = await records.getSharedRecord(b.doctor.profile.id, b.id);
            if (!out.shared) throw new Error('expected shared');
            expect(out.vitals.bp.map((r) => r.systolic)).toEqual([130]);
            expect(out.vitals.sugar).toMatchObject([{ glucoseMgDl: 140, sugarTiming: 'RANDOM' }]);
            expect(out.vitals.periods.map((p) => p.startDate)).toEqual([dayAgo(4), dayAgo(32), dayAgo(60)]);
            expect(out.vitals.periodEstimate).toMatchObject({ averageCycleDays: 28, cyclesUsed: 2 });
            expect((await testDb.healthRecordAccess.findMany({ where: { consultationId: b.id } })).map((r) => r.action)).toEqual(['RECORD']);
        });

        it('a consent on the v1 wording (no vitals named), or one sent without a version, does not show vitals; the rest of the record still shows', async () => {
            const { user, self } = await withVitals();
            for (const version of ['record-share-v1', undefined]) {
                const b = await paidBooking({ shareRecord: true, user, patient: self, version: version as string });
                if (version === undefined) await testDb.recordShareConsent.updateMany({ where: { consultationId: b.id }, data: { version: 'record-share-v1' } });
                const out = await records.getSharedRecord(b.doctor.profile.id, b.id);
                expect(out).toMatchObject({ shared: true, vitals: null });
            }
            // Sent without a version: stored as v1, never assumed to cover vitals.
            const raw = await booking.createBooking(
                { userId: user.id, patientId: self.id, slotId: (await makeSlot((await makeDoctor()).profile.id, 30 * 60)).id, idempotencyKey: `key-vit-nov-${++n}-1234`, shareRecord: true, shareMeta: { channel: 'app' } },
                { razorpay },
            );
            expect((await testDb.recordShareConsent.findFirstOrThrow({ where: { consultationId: raw.consultationId } })).version).toBe('record-share-v1');
            // The same through the route: a switch-on without a version is stored as v1.
            const viaRoute = await paidBooking({ shareRecord: false, user, patient: self });
            expect((await call('PUT', `/bookings/${viaRoute.id}/record-sharing`, user, { share: true })).status).toBe(200);
            expect((await testDb.recordShareConsent.findFirstOrThrow({ where: { consultationId: viaRoute.id } })).version).toBe('record-share-v1');
            expect(await records.getSharedRecord(viaRoute.doctor.profile.id, viaRoute.id)).toMatchObject({ shared: true, vitals: null });
            // Switching on again from the booking page with the v2 wording opens vitals.
            const b = await paidBooking({ shareRecord: true, user, patient: self, version: 'record-share-v1' });
            await records.setRecordSharing(user.id, b.id, false, { version: 'record-share-v2' });
            await records.setRecordSharing(user.id, b.id, true, { version: 'record-share-v2' });
            const out = await records.getSharedRecord(b.doctor.profile.id, b.id);
            if (!out.shared) throw new Error('expected shared');
            expect(out.vitals?.bp).toHaveLength(1);
        });

        it('the record says how many readings there are in all when the list is cut', async () => {
            const { user, self } = await withVitals();
            const b = await paidBooking({ shareRecord: true, user, patient: self });
            const out = await vitals.vitalsForRecord(testDb, self.id, new Date(), { readings: 1 });
            expect(out.bp).toHaveLength(1);
            expect(out.totals).toEqual({ bp: 1, sugar: 1, periods: 3 });
            const wide = await vitals.vitalsForRecord(testDb, self.id, new Date(), { days: 365, readings: 1 });
            expect(wide.totals.bp).toBe(2);
            expect(wide.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(b.id).toBeTruthy();
        });

        it('without the tick, or after the 7-day window, the doctor gets no vitals', async () => {
            const { user, self } = await withVitals();
            const unshared = await paidBooking({ shareRecord: false, user, patient: self });
            const closed = await records.getSharedRecord(unshared.doctor.profile.id, unshared.id);
            expect(closed).toMatchObject({ shared: false, reason: 'NOT_SHARED' });
            expect('vitals' in closed).toBe(false);

            const shared = await paidBooking({ shareRecord: true, user, patient: self });
            const later = new Date(shared.slot.endsAt.getTime() + 8 * DAY);
            const ended = await records.getSharedRecord(shared.doctor.profile.id, shared.id, {}, { now: () => later });
            expect(ended).toMatchObject({ shared: false, reason: 'ENDED' });
            expect('vitals' in ended).toBe(false);
        });

        it('the super admin view lists the vitals (a year back) and writes its audit row', async () => {
            const { user, self } = await withVitals();
            const admin = await makeUser();
            const { getPatientRecord } = await import('./consultations.adminRecords');
            const out = await getPatientRecord(self.id, { adminId: admin.id, adminName: 'Asha' });
            expect(out.vitals.bp.map((r) => r.systolic)).toEqual([130, 150]);
            expect(out.vitals.periods).toHaveLength(3);
            expect(await testDb.adminAuditLog.count({ where: { targetId: self.id, action: 'PATIENT_RECORD_VIEW' } })).toBe(1);
            expect(user.id).toBeTruthy();
        });

        it('account deletion removes every reading and period log of the account, including kept family profiles', async () => {
            const { deleteAccount } = await import('../../services/accountDeletion');
            const { user, self } = await withVitals();
            // A family profile on a past booking is kept (de-identified); its vitals still go.
            await paidBooking({ shareRecord: false, user, patient: self });
            await testDb.consultation.updateMany({ where: { userId: user.id }, data: { status: 'COMPLETED', endedAt: new Date() } });
            await deleteAccount(user.id);
            expect(await testDb.patient.count({ where: { id: self.id } })).toBe(1);
            expect(await testDb.vitalReading.count({ where: { userId: user.id } })).toBe(0);
            expect(await testDb.periodLog.count({ where: { userId: user.id } })).toBe(0);
        });
    });
});
