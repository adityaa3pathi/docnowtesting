import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';

describeDb('instant consults: Consult a Doc now (real Postgres)', () => {
    let instant: typeof import('./consultations.instant');
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let cancellation: typeof import('./consultations.cancellation');
    let noShow: typeof import('./consultations.noShow');
    let room: typeof import('./consultations.room');
    let razorpay: FakeRazorpay;
    let gp: { id: string };

    beforeAll(async () => {
        instant = await import('./consultations.instant');
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        cancellation = await import('./consultations.cancellation');
        noShow = await import('./consultations.noShow');
        room = await import('./consultations.room');
        gp = await testDb.specialty.upsert({ where: { name: 'General Physician' }, update: { slug: 'general-physician', isActive: true }, create: { name: 'General Physician', slug: 'general-physician' } });
    });
    afterAll(async () => {
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    const db = () => testDb;
    const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

    async function gpDoctor(fee = 350) {
        const d = await makeDoctor();
        await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { specialtyId: gp.id, consultationFee: fee } });
        return d;
    }
    async function onlineGp(now: Date, fee = 350) {
        const d = await gpDoctor(fee);
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
    const row = (id: string) => testDb.instantRequest.findUniqueOrThrow({ where: { id } });

    /** The open panel checks in every few seconds; tests that jump the clock do it every 20 s. */
    async function keepAlive(doctorId: string, from: Date, to: Date) {
        for (let t = from.getTime(); t <= to.getTime(); t += 20_000) {
            await testDb.doctorPresence.updateMany({ where: { doctorId, endedAt: null }, data: { lastSeenAt: new Date(t) } });
        }
    }

    /** The doctor being rung accepts, then the patient presses Pay (card). */
    async function acceptedAndBooked(now: Date) {
        await onlineGp(now);
        const p = await asker();
        const view = await start(p, now);
        const d = { profile: { id: (await row(view.id)).doctorId! } };
        await instant.acceptInstant(d.profile.id, view.id, { db: db(), now: at(now, 5_000) });
        const r = await row(view.id);
        const res = await booking.createBooking(
            { userId: p.user.id, patientId: p.patient.id, slotId: r.slotId!, idempotencyKey: 'instant-key-1', instantRequestId: r.id },
            { razorpay, now: () => at(now, 10_000) },
        );
        return { d, p, r, res };
    }

    // ── Doctor presence ──

    it('lets only approved GPs go online, and a second tab keeps one online period', async () => {
        const now = new Date();
        const other = await makeDoctor();
        await expect(instant.goOnline(other.profile.id, { db: db(), now })).rejects.toMatchObject({ status: 403 });
        const d = await gpDoctor();
        const s1 = await instant.goOnline(d.profile.id, { db: db(), now });
        const s2 = await instant.goOnline(d.profile.id, { db: db(), now: at(now, 1000) });
        expect(s1.online && s2.online).toBe(true);
        expect(await testDb.doctorPresence.count({ where: { doctorId: d.profile.id } })).toBe(1);
        await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { status: 'SUSPENDED' } });
        expect((await instant.instantAvailability({ db: db(), now })).online).toBe(0);
    });

    it('takes a doctor offline after 60 s without a check-in, ending the period at the last check-in', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        await instant.doctorCheckIn(d.profile.id, { db: db(), now: at(now, 20_000) });
        expect((await instant.instantAvailability({ db: db(), now: at(now, 70_000) })).online).toBe(1);
        const state = await instant.doctorCheckIn(d.profile.id, { db: db(), now: at(now, 81_000) });
        expect(state.online).toBe(false);
        expect(state.offlineReason).toBe('TIMEOUT');
        const p = await testDb.doctorPresence.findFirstOrThrow({ where: { doctorId: d.profile.id } });
        expect(p.endedAt!.getTime()).toBe(at(now, 20_000).getTime());
    });

    // ── Matching ──

    it('refuses to start when no Doc is online, and charges nothing ever before an accept', async () => {
        const now = new Date();
        await expect(start(await asker(), now)).rejects.toMatchObject({ status: 409, message: instant.NO_DOCTORS_ONLINE });
        await onlineGp(now);
        const view = await start(await asker(), now);
        // The patient sees "looking", never which doctor is being asked.
        expect(view).toMatchObject({ status: 'SEARCHING', doctor: null, position: 1, consultationId: null });
        expect((await row(view.id)).status).toBe('RINGING');
        expect(await testDb.consultation.count()).toBe(0);
        expect(razorpay.orders).toHaveLength(0);
    });

    it('rings one free doctor for one patient when two patients race, and queues the other', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        const [a, b] = [await asker(), await asker()];
        const [va, vb] = await Promise.all([start(a, now), start(b, at(now, 1))]);
        // Several matcher runs at once still ring the doctor only once.
        await Promise.all([1, 2, 3, 4].map(() => instant.advanceInstant({ db: db(), now: at(now, 10) })));
        const rows = await testDb.instantRequest.findMany({ where: { id: { in: [va.id, vb.id] } } });
        expect(rows.filter((r) => r.status === 'RINGING')).toHaveLength(1);
        expect(rows.filter((r) => r.doctorId === d.profile.id)).toHaveLength(1);
        const waiting = rows.find((r) => r.status === 'SEARCHING')!;
        const view = await instant.instantView(waiting.userId, waiting.id, { db: db(), now });
        expect(view.position).toBe(1);
        expect(view.doctorsFree).toBe(0);
    });

    it('keeps one live request per account: starting again returns the running one', async () => {
        const now = new Date();
        await onlineGp(now);
        const p = await asker();
        const [one, two] = await Promise.all([start(p, now), start(p, now)]);
        expect(one.id).toBe(two.id);
        expect(await testDb.instantRequest.count()).toBe(1);
    });

    it('does not ring a doctor in a call or with a booked consultation due soon', async () => {
        const now = new Date();
        const inCall = await onlineGp(now);
        const dueSoon = await onlineGp(now);
        const anyone = await asker();
        for (const [doc, startsIn, status] of [[inCall, -5, 'IN_PROGRESS'], [dueSoon, 12, 'CONFIRMED']] as const) {
            const slot = await testDb.slot.create({ data: { doctorId: doc.profile.id, startsAt: at(now, startsIn * 60_000), endsAt: at(now, (startsIn + 15) * 60_000), status: 'BOOKED' } });
            await testDb.consultation.create({
                data: {
                    userId: anyone.user.id, patientId: anyone.patient.id, doctorId: doc.profile.id, slotId: slot.id, status, feePaise: 50000, platformFeePaise: 5000,
                    policyId: 'default-consult-policy-v1', policySnapshot: {}, holdExpiresAt: now, startsAt: slot.startsAt,
                    idempotencyKey: `busy-${doc.profile.id}`, requestHash: 'x', orderReceipt: `c_${doc.profile.id.replace(/-/g, '')}`,
                },
            });
        }
        const view = await start(await asker(), now);
        expect((await row(view.id)).status).toBe('SEARCHING');
        expect((await instant.instantAvailability({ db: db(), now })).free).toBe(0);
        // The panel tells the two apart: in a call, or a booked patient due soon.
        expect(await instant.doctorInstantState(inCall.profile.id, { db: db(), now })).toMatchObject({ inConsult: true, bookedSoon: false });
        expect(await instant.doctorInstantState(dueSoon.profile.id, { db: db(), now })).toMatchObject({ inConsult: false, bookedSoon: true });
    });

    it('passes a declined or unanswered ring to the next doctor, never back to the same one', async () => {
        const now = new Date();
        const first = await onlineGp(now);
        const second = await onlineGp(at(now, 1000));
        const view = await start(await asker(), at(now, 2000));
        expect((await row(view.id)).doctorId).toBe(first.profile.id);
        await instant.declineInstant(first.profile.id, view.id, { db: db(), now: at(now, 3000) });
        await instant.advanceInstant({ db: db(), now: at(now, 3001) });
        let r = await row(view.id);
        expect(r).toMatchObject({ status: 'RINGING', doctorId: second.profile.id, triedDoctorIds: [first.profile.id] });
        // Nobody answers the second ring: back to searching, with nobody left who has not been asked.
        await instant.advanceInstant({ db: db(), now: at(now, 3001 + 60_000) });
        r = await row(view.id);
        expect(r.status).toBe('SEARCHING');
        expect(r.triedDoctorIds.sort()).toEqual([first.profile.id, second.profile.id].sort());
    });

    it('switches a doctor offline after two missed rings in a row', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        for (let i = 0; i < 2; i++) {
            const t = at(now, i * 70_000);
            await keepAlive(d.profile.id, t, t);
            await start(await asker(), t);
            await keepAlive(d.profile.id, t, at(t, 61_000));
            await instant.advanceInstant({ db: db(), now: at(t, 61_000) });
            await testDb.instantRequest.updateMany({ where: { status: 'SEARCHING' }, data: { status: 'CANCELLED' } });
        }
        const state = await instant.doctorInstantState(d.profile.id, { db: db(), now: at(now, 140_000) });
        expect(state.online).toBe(false);
        expect(state.offlineReason).toBe('MISSED_RINGS');
    });

    it('ends a search after 10 minutes with nothing charged', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        const view = await start(await asker(), now);
        await instant.declineInstant(d.profile.id, view.id, { db: db(), now: at(now, 1000) });
        await instant.advanceInstant({ db: db(), now: at(now, instant.INSTANT.searchMs + 1) });
        expect((await row(view.id)).status).toBe('NO_MATCH');
        expect(await testDb.consultation.count()).toBe(0);
    });

    // ── Accepting ──

    it('lets the doctor accept once from two tabs, and only the doctor being rung', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        const other = await onlineGp(now);
        const view = await start(await asker(), at(now, 10));
        const rungId = (await row(view.id)).doctorId!;
        const notRung = rungId === d.profile.id ? other : d;
        await expect(instant.acceptInstant(notRung.profile.id, view.id, { db: db(), now: at(now, 20) })).rejects.toMatchObject({ status: 409 });
        const results = await Promise.allSettled([1, 2].map(() => instant.acceptInstant(rungId, view.id, { db: db(), now: at(now, 30) })));
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        expect(await testDb.slot.count({ where: { doctorId: rungId } })).toBe(1);
        const r = await row(view.id);
        expect(r).toMatchObject({ status: 'ACCEPTED', doctorId: rungId });
        expect(r.payBy!.getTime()).toBe(at(now, 30 + instant.INSTANT.payMs).getTime());
        // Now the patient sees the doctor and the fee, and never before.
        const seen = await instant.instantView(r.userId, r.id, { db: db(), now: at(now, 40) });
        expect(seen.doctor).toMatchObject({ id: rungId, feePaise: 35000 });
        expect(seen.slotId).toBe(r.slotId);
    });

    it('refuses an accept after the ring ran out', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        const view = await start(await asker(), now);
        await expect(instant.acceptInstant(d.profile.id, view.id, { db: db(), now: at(now, 60_001) })).rejects.toMatchObject({ status: 409, message: instant.REQUEST_MOVED });
    });

    it('shows the doctor age, sex and reason before accepting, the name only after', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        const view = await start(await asker(), now);
        const ringing = await instant.doctorInstantState(d.profile.id, { db: db(), now });
        expect(ringing.ring).toMatchObject({ id: view.id, reason: 'Fever since yesterday', patientAge: 30, patientGender: 'F', feePaise: 35000 });
        expect(JSON.stringify(ringing.ring)).not.toContain('Test Patient');
        const accepted = await instant.acceptInstant(d.profile.id, view.id, { db: db(), now });
        expect(accepted.accepted).toMatchObject({ patientName: 'Test Patient' });
    });

    // ── Paying ──

    it('books an accepted request as an instant consultation with its own rules, held until pay-by', async () => {
        const now = new Date();
        const { r, res } = await acceptedAndBooked(now);
        expect(res.status).toBe('PENDING_PAYMENT');
        expect(res.amountPaise).toBe(35000);
        const c = await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } });
        expect(c.isInstant).toBe(true);
        // Held through the grace after pay-by, so the reconciler cannot expire a payment already under way.
        expect(c.holdExpiresAt.getTime()).toBe(r.payBy!.getTime() + instant.INSTANT.payGraceMs);
        expect(c.policySnapshot).toMatchObject({ doctorNoShowWaitMinutes: 5, maxReschedules: 0, refundTiers: [{ minHoursBefore: 0, percent: 100 }] });
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: r.slotId! } })).status).toBe('BOOKED');
        // Paid: the request is done and the consultation is the record.
        expect(await payments.confirmPayment({ paymentId: 'pay_instant0001', orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' })).toBe('confirmed');
        expect((await row(r.id)).status).toBe('BOOKED');
    });

    it('refuses to book the instant slot without its request, for another user, or after pay-by', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        const p = await asker();
        const view = await start(p, now);
        await instant.acceptInstant(d.profile.id, view.id, { db: db(), now });
        const r = await row(view.id);
        await expect(booking.createBooking({ userId: p.user.id, patientId: p.patient.id, slotId: r.slotId!, idempotencyKey: 'plain-key-1' }, { razorpay, now: () => now }))
            .rejects.toMatchObject({ status: 400 });
        const stranger = await asker();
        await expect(booking.createBooking({ userId: stranger.user.id, patientId: stranger.patient.id, slotId: r.slotId!, idempotencyKey: 'strange-key-1', instantRequestId: r.id }, { razorpay, now: () => now }))
            .rejects.toMatchObject({ status: 404 });
        await expect(booking.createBooking({ userId: p.user.id, patientId: p.patient.id, slotId: r.slotId!, idempotencyKey: 'late-key-1', instantRequestId: r.id }, { razorpay, now: () => at(now, instant.INSTANT.payMs + 1) }))
            .rejects.toMatchObject({ status: 409 });
    });

    it('frees the doctor when the patient does not pay, and refunds a payment that lands later', async () => {
        const now = new Date();
        const { d, r, res } = await acceptedAndBooked(now);
        const after = at(r.payBy!, instant.INSTANT.payGraceMs + 1);
        await keepAlive(d.profile.id, now, after);
        await instant.advanceInstant({ db: db(), now: after });
        expect((await row(r.id)).status).toBe('UNPAID');
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } })).status).toBe('EXPIRED');
        // The doctor can be rung for someone else at once.
        const next = await start(await asker(), after);
        expect((await row(next.id)).doctorId).toBe(d.profile.id);
        // The late payment is never confirmed with a doctor who moved on: it is refunded in full.
        expect(await payments.confirmPayment({ paymentId: 'pay_late000001', orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' }, { now: () => after })).toBe('refund_created');
        const refund = await testDb.consultationRefund.findFirstOrThrow({ where: { consultationId: res.consultationId } });
        expect(refund).toMatchObject({ reason: 'LATE_PAYMENT_SLOT_LOST', amountPaise: res.amountPaise });
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } })).status).toBe('EXPIRED');
    });

    it('books, not frees, when the payment confirms during the grace after pay-by', async () => {
        const now = new Date();
        const { r, res } = await acceptedAndBooked(now);
        await payments.confirmPayment({ paymentId: 'pay_grace00001', orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' }, { now: () => at(r.payBy!, 30_000) });
        await instant.advanceInstant({ db: db(), now: at(r.payBy!, instant.INSTANT.payGraceMs + 1) });
        expect((await row(r.id)).status).toBe('BOOKED');
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } })).status).toBe('CONFIRMED');
    });

    it('confirms at once when the wallet pays in full', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        const p = await asker();
        await testDb.wallet.create({ data: { userId: p.user.id, balance: 1000 } });
        const view = await start(p, now);
        await instant.acceptInstant(d.profile.id, view.id, { db: db(), now });
        const r = await row(view.id);
        const res = await booking.createBooking(
            { userId: p.user.id, patientId: p.patient.id, slotId: r.slotId!, idempotencyKey: 'wallet-key-1', instantRequestId: r.id, useWallet: true, expectedWalletPaise: 35000 },
            { razorpay, now: () => now },
        );
        expect(res.status).toBe('CONFIRMED');
        expect((await row(r.id)).status).toBe('BOOKED');
        const state = await instant.doctorInstantState(d.profile.id, { db: db(), now });
        expect(state.toJoin).toMatchObject({ consultationId: res.consultationId, patientName: 'Test Patient' });
    });

    it('lets "Not now" free the doctor before paying, and refuses it after paying', async () => {
        const now = new Date();
        const { p, r, res } = await acceptedAndBooked(now);
        const stranger = await asker();
        await expect(instant.cancelInstant(stranger.user.id, r.id, { db: db(), now })).rejects.toMatchObject({ status: 404 });
        await instant.cancelInstant(p.user.id, r.id, { db: db(), now: at(now, 20_000) });
        expect((await row(r.id)).status).toBe('CANCELLED');
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } })).status).toBe('EXPIRED');

        const second = await acceptedAndBooked(at(now, 60_000));
        await payments.confirmPayment({ paymentId: 'pay_paid000001', orderId: second.res.razorpayOrderId!, amountPaise: second.res.amountPaise, currency: 'INR' });
        await expect(instant.cancelInstant(second.p.user.id, second.r.id, { db: db(), now: at(now, 70_000) })).rejects.toMatchObject({ status: 409 });
    });

    // ── After paying: refunds ──

    it('refunds in full on a cancel until the doctor joins, even after the start, and not after', async () => {
        const now = new Date();
        const { p, res } = await acceptedAndBooked(now);
        await payments.confirmPayment({ paymentId: 'pay_cancel0001', orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
        const preview = await cancellation.cancelPreview(p.user.id, res.consultationId, { db: db(), now: () => at(now, 4 * 60_000) });
        expect(preview).toMatchObject({ percent: 100, refundPaise: 35000 });

        const other = await acceptedAndBooked(at(now, 1000));
        await payments.confirmPayment({ paymentId: 'pay_joined0001', orderId: other.res.razorpayOrderId!, amountPaise: other.res.amountPaise, currency: 'INR' });
        await testDb.consultation.update({ where: { id: other.res.consultationId }, data: { status: 'IN_PROGRESS', doctorJoinedAt: new Date() } });
        await expect(cancellation.cancelConsultation(other.res.consultationId, { kind: 'booker', userId: other.p.user.id }, undefined, { db: db(), razorpay }))
            .rejects.toMatchObject({ status: 409 });
    });

    it('gives the doctor 5 minutes from the payment, not the accept, then refunds in full', async () => {
        const now = new Date();
        const { r, res } = await acceptedAndBooked(now);
        // Paid at the last moment: 3 min 50 s after the accept.
        const paidAt = at(r.acceptedAt!, 230_000);
        await payments.confirmPayment({ paymentId: 'pay_noshow0001', orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' }, { now: () => paidAt });
        const c = await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } });
        expect(c.startsAt.getTime()).toBe(paidAt.getTime());
        expect(room.noShowDeadlines(c).doctorBy.getTime()).toBe(paidAt.getTime() + 5 * 60_000);
        // 4 minutes after paying the doctor is still in time.
        await noShow.settleNoShows({ db: db(), razorpay, now: at(paidAt, 4 * 60_000) });
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } })).status).toBe('CONFIRMED');
        await noShow.settleNoShows({ db: db(), razorpay, now: at(c.startsAt, 5 * 60_000 + 1000) });
        const after = await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId }, include: { refunds: true } });
        expect(['NO_SHOW_DOCTOR', 'REFUNDED']).toContain(after.status);
        expect(after.refunds[0]).toMatchObject({ reason: 'DOCTOR_NO_SHOW', amountPaise: 35000 });
    });

    it('takes the doctor\'s free slots under the call off sale once paid, and puts them back on a cancel', async () => {
        const now = new Date();
        const d = await onlineGp(now);
        await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { slotMinutes: 30 } });
        const under = await testDb.slot.create({ data: { doctorId: d.profile.id, startsAt: at(now, 20 * 60_000), endsAt: at(now, 50 * 60_000) } });
        const later = await testDb.slot.create({ data: { doctorId: d.profile.id, startsAt: at(now, 60 * 60_000), endsAt: at(now, 90 * 60_000) } });
        const slotStatus = async (id: string) => (await testDb.slot.findUniqueOrThrow({ where: { id } })).status;
        const p = await asker();
        const view = await start(p, now);
        await instant.acceptInstant(d.profile.id, view.id, { db: db(), now });
        // Accepting alone takes nothing off sale: the patient may never pay.
        expect(await slotStatus(under.id)).toBe('AVAILABLE');
        const r = await row(view.id);
        const res = await booking.createBooking({ userId: p.user.id, patientId: p.patient.id, slotId: r.slotId!, idempotencyKey: 'block-key-1', instantRequestId: r.id }, { razorpay, now: () => now });
        await payments.confirmPayment({ paymentId: 'pay_block00001', orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' }, { now: () => now });
        expect(await slotStatus(under.id)).toBe('BLOCKED');
        expect(await slotStatus(later.id)).toBe('AVAILABLE');
        expect((await row(view.id)).blockedSlotIds).toEqual([under.id]);
        await cancellation.cancelConsultation(res.consultationId, { kind: 'booker', userId: p.user.id }, undefined, { db: db(), razorpay, now: () => at(now, 60_000) });
        expect(await slotStatus(under.id)).toBe('AVAILABLE');
    });

    it('frees the doctor at once when the unpaid booking is cancelled from the booking page', async () => {
        const now = new Date();
        const { d, p, r, res } = await acceptedAndBooked(now);
        await cancellation.cancelConsultation(res.consultationId, { kind: 'booker', userId: p.user.id }, undefined, { db: db(), razorpay, now: () => at(now, 20_000) });
        expect((await row(r.id)).status).toBe('CANCELLED');
        const next = await start(await asker(), at(now, 21_000));
        expect((await row(next.id)).doctorId).toBe(d.profile.id);
    });
});
