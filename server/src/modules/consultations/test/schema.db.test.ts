import { afterAll, beforeEach, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './db';

describeDb('consultation schema (real Postgres)', () => {
    beforeEach(resetConsultData);
    afterAll(async () => testDb?.$disconnect());

    async function setup() {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, 24 * 60, 'BOOKED');
        return { doctor, user, patient, slot };
    }

    it('allows only one active consultation per slot, and frees it once expired', async () => {
        const { doctor, user, patient, slot } = await setup();
        const base = { userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt };
        const first = await makeConsultation(base);
        await expect(makeConsultation(base)).rejects.toMatchObject({ code: 'P2002' });
        await testDb.consultation.update({ where: { id: first.id }, data: { status: 'EXPIRED' } });
        await expect(makeConsultation(base)).resolves.toBeTruthy();
    });

    it('rejects a second payment row with the same Razorpay payment id', async () => {
        const { doctor, user, patient, slot } = await setup();
        const c = await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt });
        const data = { consultationId: c.id, razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', amountPaise: 50000 };
        await testDb.consultationPayment.create({ data });
        await expect(testDb.consultationPayment.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('has both partial indexes with the expected predicates', async () => {
        const rows = await testDb.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
            `SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('Consultation_slotId_active_key', 'ConsultPolicy_one_active_key')`,
        );
        const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
        expect(byName['Consultation_slotId_active_key']).toMatch(/UNIQUE.*WHERE/s);
        expect(byName['Consultation_slotId_active_key']).toContain("'PENDING_PAYMENT'");
        expect(byName['Consultation_slotId_active_key']).not.toContain("'EXPIRED'");
        expect(byName['Consultation_slotId_active_key']).not.toContain("'CANCELLED'");
        expect(byName['ConsultPolicy_one_active_key']).toMatch(/isActive.*true/s);
    });

    it('rejects a second active rules row', async () => {
        await expect(
            testDb.consultPolicy.create({ data: { version: 2, isActive: true, rules: {} } }),
        ).rejects.toMatchObject({ code: 'P2002' });
        await expect(testDb.consultPolicy.create({ data: { version: 3, isActive: false, rules: {} } })).resolves.toBeTruthy();
    });

    it('rejects a refund with amount 0', async () => {
        const { doctor, user, patient, slot } = await setup();
        const c = await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt });
        const pay = await testDb.consultationPayment.create({ data: { consultationId: c.id, razorpayOrderId: 'o', razorpayPaymentId: 'p', amountPaise: 100 } });
        await expect(
            testDb.consultationRefund.create({ data: { consultationId: c.id, paymentId: pay.id, reason: 'ADMIN', amountPaise: 0, receipt: 'r1' } }),
        ).rejects.toThrow();
    });

    it('scopes an idempotency key to one user', async () => {
        const doctor = await makeDoctor();
        const userA = await makeUser();
        const userB = await makeUser();
        const patientA = await makePatient(userA.id);
        const patientB = await makePatient(userB.id);
        const slotA = await makeSlot(doctor.profile.id, 1500, 'BOOKED');
        const slotB = await makeSlot(doctor.profile.id, 1600, 'BOOKED');
        const slotC = await makeSlot(doctor.profile.id, 1700, 'BOOKED');
        const common = { doctorId: doctor.profile.id, idempotencyKey: 'same-key' };
        await makeConsultation({ ...common, userId: userA.id, patientId: patientA.id, slotId: slotA.id, startsAt: slotA.startsAt });
        await expect(makeConsultation({ ...common, userId: userB.id, patientId: patientB.id, slotId: slotB.id, startsAt: slotB.startsAt })).resolves.toBeTruthy();
        await expect(makeConsultation({ ...common, userId: userA.id, patientId: patientA.id, slotId: slotC.id, startsAt: slotC.startsAt })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('reports no violations when slots and consultations agree, and finds both kinds when they do not', async () => {
        expect(await consistencyViolations()).toEqual([]);
        const { doctor, user, patient, slot } = await setup();
        const free = await makeSlot(doctor.profile.id, 3000, 'BOOKED');
        const c = await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt });
        expect(await consistencyViolations()).toEqual([{ id: free.id, problem: 'booked_without_consultation' }]);
        await testDb.slot.update({ where: { id: slot.id }, data: { status: 'AVAILABLE' } });
        expect((await consistencyViolations()).map((v) => v.problem).sort()).toEqual(['active_on_unbooked_slot', 'booked_without_consultation']);
        expect(c.id).toBeTruthy();
    });
});
