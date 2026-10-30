/** Doctor-late options against real Postgres: atomic moves, double-booking races and the full refund. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('doctor running late (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let cancel: typeof import('./consultations.cancellation');
    let reschedule: typeof import('./consultations.reschedule');
    let razorpay: FakeRazorpay;

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        cancel = await import('./consultations.cancellation');
        reschedule = await import('./consultations.reschedule');
    });
    afterAll(async () => {
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
    async function paid(doctor?: Awaited<ReturnType<typeof makeDoctor>>, minutesAhead = 60) {
        const d = doctor ?? (await makeDoctor());
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(d.profile.id, minutesAhead);
        const res = await booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-late-${++n}-12345` }, { razorpay });
        await payments.confirmPayment({ paymentId: `pay_late${String(n).padStart(6, '0')}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
        const startsAt = slot.startsAt;
        return { doctor: d, user, slot, id: res.consultationId, fee: res.amountPaise, lateNow: () => new Date(startsAt.getTime() + 6 * 60_000) };
    }
    const row = (id: string) => testDb.consultation.findUniqueOrThrow({ where: { id } });
    const slotStatus = async (id: string) => (await testDb.slot.findUniqueOrThrow({ where: { id } })).status;

    describe('reschedule', () => {
        it('moves the booking to the new slot and frees the old one, all at once', async () => {
            const a = await paid();
            const later = await makeSlot(a.doctor.profile.id, 60 + 24 * 60);

            const view = await reschedule.rescheduleBooking(a.user.id, a.id, later.id, { now: a.lateNow });

            const c = await row(a.id);
            expect(c).toMatchObject({ slotId: later.id, startsAt: later.startsAt, status: 'CONFIRMED', doctorId: a.doctor.profile.id });
            expect(await slotStatus(later.id)).toBe('BOOKED');
            expect(await slotStatus(a.slot.id)).toBe('AVAILABLE');
            expect(view.status).toBe('CONFIRMED');
            // No second payment and no refund: the patient keeps what they paid.
            expect(await testDb.consultationPayment.count({ where: { consultationId: a.id } })).toBe(1);
            expect(await testDb.consultationRefund.count({ where: { consultationId: a.id } })).toBe(0);
        });

        it('rejects a slot already booked by another patient and leaves the booking as it was', async () => {
            const a = await paid();
            const other = await paid(a.doctor, 60 + 24 * 60);

            await expect(reschedule.rescheduleBooking(a.user.id, a.id, other.slot.id, { now: a.lateNow })).rejects.toMatchObject({ status: 409 });

            expect((await row(a.id)).slotId).toBe(a.slot.id);
            expect((await row(other.id)).slotId).toBe(other.slot.id);
            expect(await slotStatus(a.slot.id)).toBe('BOOKED');
        });

        it('lets only one of two late patients take the same free slot', async () => {
            const a = await paid();
            const b = await paid(a.doctor, 75);
            const free = await makeSlot(a.doctor.profile.id, 60 + 24 * 60);
            const now = () => new Date(b.slot.startsAt.getTime() + 6 * 60_000);

            const results = await Promise.allSettled([
                reschedule.rescheduleBooking(a.user.id, a.id, free.id, { now }),
                reschedule.rescheduleBooking(b.user.id, b.id, free.id, { now }),
            ]);

            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            expect(await testDb.consultation.count({ where: { slotId: free.id } })).toBe(1);
        });

        it('is refused before the doctor is 5 minutes late', async () => {
            const a = await paid();
            const later = await makeSlot(a.doctor.profile.id, 60 + 24 * 60);
            const early = () => new Date(a.slot.startsAt.getTime() + 2 * 60_000);
            await expect(reschedule.rescheduleBooking(a.user.id, a.id, later.id, { now: early })).rejects.toMatchObject({ status: 409 });
            expect((await row(a.id)).slotId).toBe(a.slot.id);
        });
    });

    describe('next available doctor', () => {
        it('offers the earliest free doctor of the same specialty and moves the booking to them', async () => {
            const a = await paid();
            const other = await makeDoctor();
            const soon = await makeSlot(other.profile.id, 70);
            const now = a.lateNow;

            const option = await reschedule.reassignOption(a.user.id, a.id, { now });
            expect(option).toMatchObject({ slot: { id: soon.id }, doctor: { id: other.profile.id } });

            await reschedule.reassignBooking(a.user.id, a.id, soon.id, { now });
            expect(await row(a.id)).toMatchObject({ doctorId: other.profile.id, slotId: soon.id, status: 'CONFIRMED' });
            expect(await slotStatus(a.slot.id)).toBe('AVAILABLE');
        });

        it('never offers a doctor with a higher fee', async () => {
            const a = await paid();
            const pricier = await makeDoctor();
            await testDb.doctorProfile.update({ where: { id: pricier.profile.id }, data: { consultationFee: 900 } });
            await makeSlot(pricier.profile.id, 70);
            expect(await reschedule.reassignOption(a.user.id, a.id, { now: a.lateNow })).toBeNull();
        });
    });

    describe('cancel because the doctor is late', () => {
        it('refunds 100% even inside the no-refund tier', async () => {
            const a = await paid();
            // 6 minutes after the start the tiers give 0%; the doctor's delay overrides them.
            const view = await cancel.cancelConsultation(a.id, { kind: 'booker', userId: a.user.id }, 'DOCTOR_LATE', { razorpay, now: a.lateNow });

            const refunds = await testDb.consultationRefund.findMany({ where: { consultationId: a.id } });
            expect(refunds).toHaveLength(1);
            expect(refunds[0]).toMatchObject({ reason: 'DOCTOR_NO_SHOW', amountPaise: a.fee });
            expect(view.refundPaise).toBe(a.fee);
            expect(razorpay.refunds[0]?.amount).toBe(a.fee);
            const c = await row(a.id);
            expect(c.cancelReason).toBe('DOCTOR_LATE');
            // Not flagged for staff review: the patient must not see "under staff check".
            expect(c.reviewReason).toBeNull();
            expect(await slotStatus(a.slot.id)).toBe('AVAILABLE');
        });

        it('is refused, with nothing changed, while the doctor is not late', async () => {
            const a = await paid();
            const early = () => new Date(a.slot.startsAt.getTime() - 30 * 60_000);
            await expect(cancel.cancelConsultation(a.id, { kind: 'booker', userId: a.user.id }, 'DOCTOR_LATE', { razorpay, now: early })).rejects.toMatchObject({ status: 409 });
            expect((await row(a.id)).status).toBe('CONFIRMED');
            expect(await testDb.consultationRefund.count({ where: { consultationId: a.id } })).toBe(0);
        });
    });
});
