import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { FakeVideo } from './test/fakeVideo';
import { useTestJwtSecret } from './test/http';

useTestJwtSecret();

const MIN = 60_000;
const TEMPLATES = { CONFIRMED: 'c_tpl', REMINDER: 'r_tpl', JOIN_NOW: 'j_tpl', DOCTOR_NO_SHOW: 'n_tpl', PATIENT_NO_SHOW: 'p_tpl' };

describeDb('consultation timers: no-shows and messages (real Postgres)', () => {
    let noShow: typeof import('./consultations.noShow');
    let notices: typeof import('./consultations.notifications');
    let room: typeof import('./consultations.room');
    let razorpay: FakeRazorpay;
    let video: FakeVideo;
    let sent: { mobile: string; template: string; components: any[] }[];
    let failNext: number;

    beforeAll(async () => {
        noShow = await import('./consultations.noShow');
        notices = await import('./consultations.notifications');
        room = await import('./consultations.room');
    });
    afterAll(async () => {
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
        video = new FakeVideo();
        sent = [];
        failNext = 0;
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    const send = async (mobile: string, template: string, _lang: string, components: any[]) => {
        if (failNext > 0) {
            failNext--;
            throw new Error('provider down');
        }
        sent.push({ mobile, template, components });
        return { id: `wa_${sent.length}` };
    };
    const runNotices = (now: Date) => notices.sendDueNotices({ send, now, templates: TEMPLATES });

    /** A paid, confirmed consultation starting `startsInMinutes` from now, booked a day earlier. */
    async function paid(startsInMinutes: number) {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, startsInMinutes, 'BOOKED');
        const c = await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt, status: 'CONFIRMED' });
        const payId = `pay_t${c.id.replace(/-/g, '').slice(0, 12)}`;
        await testDb.consultationPayment.create({
            data: { consultationId: c.id, razorpayOrderId: `order_${c.id.slice(0, 8)}`, razorpayPaymentId: payId, amountPaise: 55000, status: 'CAPTURED' },
        });
        await testDb.consultation.update({
            where: { id: c.id },
            data: { confirmingPaymentId: payId, createdAt: new Date(Date.now() - 24 * 60 * MIN), policySnapshot: { doctorNoShowWaitMinutes: 10, patientNoShowWaitMinutes: 10 } },
        });
        return { doctor, user, patient, slot, c };
    }
    const row = (id: string) => testDb.consultation.findUniqueOrThrow({ where: { id }, include: { refunds: true } });

    describe('no-shows', () => {
        it('marks the doctor absent after their wait and refunds the patient in full', async () => {
            const b = await paid(-11);
            expect(await noShow.settleNoShows({ razorpay })).toEqual({ doctors: 1, patients: 0 });
            const c = await row(b.c.id);
            expect(c.status).toBe('REFUNDED');
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: b.slot.id } })).status).toBe('AVAILABLE');
            expect(c.refunds).toMatchObject([{ reason: 'DOCTOR_NO_SHOW', amountPaise: 55000 }]);
            expect(razorpay.refunds).toHaveLength(1);
            expect(await noShow.settleNoShows({ razorpay })).toEqual({ doctors: 0, patients: 0 });
        });

        it('waits until the deadline, even when the patient is already waiting', async () => {
            const b = await paid(-9);
            await room.patientJoin(b.user.id, b.c.id, { video });
            expect(await noShow.settleNoShows({ razorpay })).toEqual({ doctors: 0, patients: 0 });
            expect((await row(b.c.id)).status).toBe('WAITING');
        });

        it('stops a doctor joining after the deadline', async () => {
            const b = await paid(-11);
            await expect(room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video })).rejects.toMatchObject({ status: 409 });
            expect(video.roomsCreated).toHaveLength(0);
        });

        it('marks the patient absent when the doctor joined and they did not, with no refund', async () => {
            const b = await paid(-11);
            await room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video, now: new Date(b.c.startsAt.getTime() + MIN) });
            expect(await noShow.settleNoShows({ razorpay })).toEqual({ doctors: 0, patients: 1 });
            const c = await row(b.c.id);
            expect(c.status).toBe('NO_SHOW_PATIENT');
            expect(c.refunds).toEqual([]);
        });

        it('leaves a call where both joined alone', async () => {
            const b = await paid(-11);
            await room.patientJoin(b.user.id, b.c.id, { video });
            await room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video, now: new Date(b.c.startsAt.getTime() + MIN) });
            expect(await noShow.settleNoShows({ razorpay })).toEqual({ doctors: 0, patients: 0 });
            expect((await row(b.c.id)).status).toBe('IN_PROGRESS');
        });
    });

    describe('messages', () => {
        it('confirms once, reminds both an hour before, and sends join links at 10 minutes', async () => {
            const b = await paid(120);
            const start = b.c.startsAt.getTime();
            await runNotices(new Date(start - 120 * MIN));
            await runNotices(new Date(start - 119 * MIN));
            expect(sent.map((s) => s.template)).toEqual(['c_tpl']);

            await runNotices(new Date(start - 50 * MIN));
            expect(sent.filter((s) => s.template === 'r_tpl').map((s) => s.mobile).sort()).toEqual([b.doctor.user.mobile, b.user.mobile].sort());

            await runNotices(new Date(start - 5 * MIN));
            const joins = sent.filter((s) => s.template === 'j_tpl');
            expect(joins).toHaveLength(2);
            const patientJoin = joins.find((s) => s.mobile === b.user.mobile)!;
            expect(patientJoin.components[1].parameters[0].text).toBe(`consult/booking/${b.c.id}`);
            const doctorJoin = joins.find((s) => s.mobile === b.doctor.user.mobile)!;
            expect(doctorJoin.components[1].parameters[0].text).toBe(`doctor/consultations/${b.c.id}`);
        });

        it('skips the patient reminder for a booking made within the hour', async () => {
            const b = await paid(40);
            await testDb.consultation.update({ where: { id: b.c.id }, data: { createdAt: new Date() } });
            await runNotices(new Date());
            expect(sent.filter((s) => s.mobile === b.user.mobile).map((s) => s.template)).toEqual(['c_tpl']);
            expect(sent.filter((s) => s.mobile === b.doctor.user.mobile).map((s) => s.template)).toEqual(['r_tpl']);
        });

        it('tells the patient about a doctor no-show with the refund amount', async () => {
            const b = await paid(-11);
            await noShow.settleNoShows({ razorpay });
            await runNotices(new Date());
            const notice = sent.find((s) => s.template === 'n_tpl')!;
            expect(notice.mobile).toBe(b.user.mobile);
            expect(notice.components[0].parameters.map((p: any) => p.text)).toEqual(['Test Patient', 'Dr. Dr Test', 'Rs. 550.00']);
        });

        it('offers the same doctor again after a patient no-show', async () => {
            const b = await paid(-11);
            await room.doctorJoin(b.doctor.profile.id, b.doctor.user.id, b.c.id, { video, now: new Date(b.c.startsAt.getTime() + MIN) });
            await noShow.settleNoShows({ razorpay });
            await runNotices(new Date());
            const notice = sent.find((s) => s.template === 'p_tpl')!;
            expect(notice.mobile).toBe(b.user.mobile);
            expect(notice.components[1].parameters[0].text).toBe(`consult/doctors/${b.doctor.profile.id}`);
        });

        it('retries a failed send while still due, and never sends twice', async () => {
            const b = await paid(120);
            failNext = 1;
            await runNotices(new Date(b.c.startsAt.getTime() - 120 * MIN));
            expect(sent).toHaveLength(0);
            await runNotices(new Date(b.c.startsAt.getTime() - 119 * MIN));
            await runNotices(new Date(b.c.startsAt.getTime() - 118 * MIN));
            expect(sent.map((s) => s.template)).toEqual(['c_tpl']);
            const n = await testDb.consultationNotification.findFirstOrThrow({ where: { consultationId: b.c.id, kind: 'CONFIRMED' } });
            expect(n).toMatchObject({ status: 'SENT', attempts: 2 });
        });

        it('sends nothing for a kind without a template', async () => {
            const b = await paid(5);
            await notices.sendDueNotices({ send, now: new Date(), templates: { CONFIRMED: 'c_tpl' } });
            expect(sent).toHaveLength(0);
            expect(await testDb.consultationNotification.count({ where: { consultationId: b.c.id } })).toBe(0);
        });
    });
});
