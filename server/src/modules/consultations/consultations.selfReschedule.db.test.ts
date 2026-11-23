/**
 * Patient changes the time (same doctor, within the booking's rules) against real Postgres:
 * the cutoff, the limit, races for one slot, the refund basis, notices, the move record and access.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

const HOUR = 60;
const DAY = 24 * HOUR;

describeDb('patient changes the time (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let cancel: typeof import('./consultations.cancellation');
    let reschedule: typeof import('./consultations.reschedule');
    let app: { url: string; close: () => Promise<void> };
    let doctorApp: { url: string; close: () => Promise<void> };
    let razorpay: FakeRazorpay;

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        cancel = await import('./consultations.cancellation');
        reschedule = await import('./consultations.reschedule');
        app = await serve('/consult', (await import('./consultations.routes')).consultPatientRoutes);
        doctorApp = await serve('/doctor', (await import('./doctors.routes')).doctorRoutes);
    });
    afterAll(async () => {
        await app?.close();
        await doctorApp?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        // A slot is booked exactly when one active consultation points at it.
        expect(await consistencyViolations()).toEqual([]);
    });

    let n = 0;
    async function paid(minutesAhead: number, doctor?: Awaited<ReturnType<typeof makeDoctor>>) {
        const d = doctor ?? (await makeDoctor());
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(d.profile.id, minutesAhead);
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-move-${++n}-12345` }, { razorpay });
        await payments.confirmPayment({ paymentId: `pay_move${String(n).padStart(6, '0')}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
        return { doctor: d, user, patient, slot, id: res.consultationId, fee: res.amountPaise };
    }
    const row = (id: string) => testDb.consultation.findUniqueOrThrow({ where: { id } });
    const slotStatus = async (id: string) => (await testDb.slot.findUniqueOrThrow({ where: { id } })).status;
    const changeTime = (id: string, user: { id: string; tokenVersion: number }, newSlotId: string) =>
        fetch(`${app.url}/consult/bookings/${id}/change-time`, {
            method: 'POST',
            headers: { authorization: `Bearer ${tokenFor(user)}`, 'content-type': 'application/json' },
            body: JSON.stringify({ newSlotId }),
        });

    it('moves to another free time of the same doctor: new slot booked, old freed, counted, recorded', async () => {
        const a = await paid(DAY);
        const later = await makeSlot(a.doctor.profile.id, 3 * DAY);
        await testDb.consultationNotification.create({ data: { consultationId: a.id, kind: 'CONFIRMED', recipient: 'patient', status: 'SENT' } });

        const res = await changeTime(a.id, a.user, later.id);
        expect(res.status).toBe(200);
        const view = await res.json();
        expect(view.selfReschedule).toMatchObject({ allowed: true, used: 1, max: 2, cutoffMinutes: 120 });
        expect(Date.parse(view.startsAt)).toBe(later.startsAt.getTime());

        const c = await row(a.id);
        expect(c).toMatchObject({ slotId: later.id, startsAt: later.startsAt, status: 'CONFIRMED', rescheduleCount: 1, refundBasisStartsAt: a.slot.startsAt });
        expect(await slotStatus(later.id)).toBe('BOOKED');
        expect(await slotStatus(a.slot.id)).toBe('AVAILABLE');
        // The confirmation goes out again with the new time.
        expect(await testDb.consultationNotification.count({ where: { consultationId: a.id } })).toBe(0);
        const moves = await testDb.consultationMove.findMany({ where: { consultationId: a.id } });
        expect(moves).toHaveLength(1);
        expect(moves[0]).toMatchObject({ kind: 'PATIENT_RESCHEDULE', fromSlotId: a.slot.id, fromStartsAt: a.slot.startsAt, toSlotId: later.id, byUserId: a.user.id });
        // No new payment and no refund.
        expect(await testDb.consultationPayment.count({ where: { consultationId: a.id } })).toBe(1);
        expect(await testDb.consultationRefund.count({ where: { consultationId: a.id } })).toBe(0);
    });

    it('the doctor sees the new time in their list', async () => {
        const a = await paid(DAY);
        const later = await makeSlot(a.doctor.profile.id, 2 * DAY);
        expect((await changeTime(a.id, a.user, later.id)).status).toBe(200);
        const list = await (await fetch(`${doctorApp.url}/doctor/me/consultations?scope=upcoming`, { headers: { authorization: `Bearer ${tokenFor(a.doctor.user)}` } })).json();
        expect(list.items).toHaveLength(1);
        expect(Date.parse(list.items[0].startsAt)).toBe(later.startsAt.getTime());
    });

    it('closes 2 hours before the start, and changes nothing', async () => {
        const a = await paid(90);
        const later = await makeSlot(a.doctor.profile.id, DAY);
        const res = await changeTime(a.id, a.user, later.id);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('The time can be changed only until 2 hours before the start.');
        expect((await row(a.id)).slotId).toBe(a.slot.id);
        expect(await slotStatus(later.id)).toBe('AVAILABLE');
        const view = await booking.getBooking(a.user.id, a.id);
        expect(view).toMatchObject({ selfReschedule: { allowed: false, used: 0 } });
    });

    it('allows two changes, refuses the third', async () => {
        const a = await paid(DAY);
        const s1 = await makeSlot(a.doctor.profile.id, 2 * DAY);
        const s2 = await makeSlot(a.doctor.profile.id, 3 * DAY);
        const s3 = await makeSlot(a.doctor.profile.id, 4 * DAY);
        expect((await changeTime(a.id, a.user, s1.id)).status).toBe(200);
        expect((await changeTime(a.id, a.user, s2.id)).status).toBe(200);
        const third = await changeTime(a.id, a.user, s3.id);
        expect(third.status).toBe(409);
        expect((await third.json()).error).toMatch(/already changed the time 2 times/);
        expect(await row(a.id)).toMatchObject({ slotId: s2.id, rescheduleCount: 2 });
        expect(await slotStatus(s1.id)).toBe('AVAILABLE');
        expect(await slotStatus(s3.id)).toBe('AVAILABLE');
    });

    it('two patients racing for one free slot: exactly one gets it', async () => {
        const a = await paid(DAY);
        const b = await paid(DAY + 30, a.doctor);
        const target = await makeSlot(a.doctor.profile.id, 2 * DAY);
        const results = await Promise.allSettled([
            reschedule.selfRescheduleBooking(a.user.id, a.id, target.id),
            reschedule.selfRescheduleBooking(b.user.id, b.id, target.id),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(lost.reason).toMatchObject({ status: 409 });
        const rows = [await row(a.id), await row(b.id)];
        expect(rows.filter((r) => r.slotId === target.id)).toHaveLength(1);
        // The loser keeps their own slot and their count.
        const loser = rows.find((r) => r.slotId !== target.id)!;
        expect(loser.rescheduleCount).toBe(0);
        expect(await slotStatus(loser.slotId)).toBe('BOOKED');
    });

    it('the same booking from two tabs at once moves only once', async () => {
        const a = await paid(DAY);
        const x = await makeSlot(a.doctor.profile.id, 2 * DAY);
        const y = await makeSlot(a.doctor.profile.id, 3 * DAY);
        const results = await Promise.allSettled([
            reschedule.selfRescheduleBooking(a.user.id, a.id, x.id),
            reschedule.selfRescheduleBooking(a.user.id, a.id, y.id),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const c = await row(a.id);
        expect(c.rescheduleCount).toBe(1);
        const other = c.slotId === x.id ? y : x;
        expect(await slotStatus(other.id)).toBe('AVAILABLE');
        expect(await testDb.consultationMove.count({ where: { consultationId: a.id } })).toBe(1);
    });

    it('refuses another doctor\'s slot, a slot starting too soon, the current slot, and a booked slot', async () => {
        const a = await paid(DAY);
        const elsewhere = await makeSlot((await makeDoctor()).profile.id, 2 * DAY);
        expect((await changeTime(a.id, a.user, elsewhere.id)).status).toBe(404);
        const soon = await makeSlot(a.doctor.profile.id, 5);
        expect((await changeTime(a.id, a.user, soon.id)).status).toBe(400);
        expect((await changeTime(a.id, a.user, a.slot.id)).status).toBe(400);
        const taken = await paid(2 * DAY, a.doctor);
        expect((await changeTime(a.id, a.user, taken.slot.id)).status).toBe(409);
        expect(await row(a.id)).toMatchObject({ slotId: a.slot.id, rescheduleCount: 0 });
    });

    it('only the booker can change the time; another account gets 404', async () => {
        const a = await paid(DAY);
        const later = await makeSlot(a.doctor.profile.id, 2 * DAY);
        expect((await changeTime(a.id, await makeUser(), later.id)).status).toBe(404);
        expect((await changeTime(a.id, a.doctor.user, later.id)).status).toBe(404);
        expect(await slotStatus(later.id)).toBe('AVAILABLE');
    });

    it('a cancelled booking cannot be moved', async () => {
        const a = await paid(DAY);
        await cancel.cancelConsultation(a.id, { kind: 'booker', userId: a.user.id }, 'plans changed');
        const later = await makeSlot(a.doctor.profile.id, 2 * DAY);
        const res = await changeTime(a.id, a.user, later.id);
        expect(res.status).toBe(409);
        expect(await slotStatus(later.id)).toBe('AVAILABLE');
    });

    it('moving later never raises the refund: the tiers count to the original time', async () => {
        // 12 hours ahead is the 50% tier (6 to 24 h); a week ahead would be 100%.
        const a = await paid(12 * HOUR);
        const nextWeek = await makeSlot(a.doctor.profile.id, 7 * DAY);
        expect((await changeTime(a.id, a.user, nextWeek.id)).status).toBe(200);
        const preview = await cancel.cancelPreview(a.user.id, a.id);
        expect(preview.percent).toBe(50);
        expect(preview.refundBasisStartsAt).toEqual(a.slot.startsAt);
        await cancel.cancelConsultation(a.id, { kind: 'booker', userId: a.user.id }, 'not needed');
        const refunds = await testDb.consultationRefund.findMany({ where: { consultationId: a.id } });
        expect(refunds.reduce((s, r) => s + r.amountPaise, 0)).toBe(a.fee / 2);
    });

    it('moving earlier uses the new, earlier time', async () => {
        const a = await paid(7 * DAY);
        const sooner = await makeSlot(a.doctor.profile.id, 12 * HOUR);
        expect((await changeTime(a.id, a.user, sooner.id)).status).toBe(200);
        expect((await row(a.id)).refundBasisStartsAt).toEqual(sooner.startsAt);
        expect((await cancel.cancelPreview(a.user.id, a.id)).percent).toBe(50);
    });

    it('a booking whose copied rules predate rescheduling gets the defaults; a 0 limit turns it off', async () => {
        const a = await paid(DAY);
        const later = await makeSlot(a.doctor.profile.id, 2 * DAY);
        const c = await row(a.id);
        const { rescheduleCutoffMinutes: _cut, maxReschedules: _max, ...older } = c.policySnapshot as Record<string, unknown>;
        await testDb.consultation.update({ where: { id: a.id }, data: { policySnapshot: older as never } });
        expect((await booking.getBooking(a.user.id, a.id))).toMatchObject({ selfReschedule: { allowed: true, max: 2, cutoffMinutes: 120 } });

        await testDb.consultation.update({ where: { id: a.id }, data: { policySnapshot: { ...older, maxReschedules: 0 } as never } });
        const res = await changeTime(a.id, a.user, later.id);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('Changing the time is not available for this booking.');
    });

    it('a later move because the doctor was late resets the refund basis and who had joined', async () => {
        // Moved once by the patient (basis = the first time), then the doctor is late at the new time.
        const a = await paid(DAY);
        const s1 = await makeSlot(a.doctor.profile.id, 2 * DAY);
        expect((await changeTime(a.id, a.user, s1.id)).status).toBe(200);
        expect((await row(a.id)).refundBasisStartsAt).toEqual(a.slot.startsAt);
        const lateNow = new Date(s1.startsAt.getTime() + 6 * 60_000);
        await testDb.consultation.update({ where: { id: a.id }, data: { patientJoinedAt: s1.startsAt, familyJoinedAt: s1.startsAt, caregiverJoinedAt: s1.startsAt } });
        const s2 = await makeSlot(a.doctor.profile.id, 5 * DAY);

        await reschedule.rescheduleBooking(a.user.id, a.id, s2.id, { now: () => lateNow });

        const c = await row(a.id);
        expect(c).toMatchObject({ slotId: s2.id, refundBasisStartsAt: null, patientJoinedAt: null, familyJoinedAt: null, caregiverJoinedAt: null, rescheduleCount: 1 });
        const kinds = (await testDb.consultationMove.findMany({ where: { consultationId: a.id }, orderBy: { createdAt: 'asc' } })).map((m) => m.kind);
        expect(kinds).toEqual(['PATIENT_RESCHEDULE', 'DOCTOR_LATE_RESCHEDULE']);
        // Cancelling normally now counts from the new time (5 days out: full refund).
        expect((await cancel.cancelPreview(a.user.id, a.id, { now: () => lateNow })).percent).toBe(100);
    });

    it('tells the client the booking\'s own lead time for the picker', async () => {
        const a = await paid(DAY);
        const c = await row(a.id);
        await testDb.consultation.update({ where: { id: a.id }, data: { policySnapshot: { ...(c.policySnapshot as object), minLeadMinutes: 60 } } });
        expect(await booking.getBooking(a.user.id, a.id)).toMatchObject({ selfReschedule: { minLeadMinutes: 60 } });
    });
});

