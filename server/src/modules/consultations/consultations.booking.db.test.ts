import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from './consultations.policy';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('consultation booking (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let service: typeof import('./doctors.service');
    let policy: typeof import('./consultations.policy.service');
    let razorpay: FakeRazorpay;
    let server: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        service = await import('./doctors.service');
        policy = await import('./consultations.policy.service');
        const { consultPatientRoutes } = await import('./consultations.routes');
        server = await serve('/consult', consultPatientRoutes);
    });
    afterAll(async () => {
        await server?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    async function world(slotStartsInMinutes = 24 * 60) {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, slotStartsInMinutes);
        return { doctor, user, patient, slot };
    }
    const book = (w: { user: { id: string }; patient: { id: string }; slot: { id: string } }, key = 'key-12345678') =>
        booking.createBooking({ userId: w.user.id, patientId: w.patient.id, slotId: w.slot.id, idempotencyKey: key }, { razorpay });

    it('holds the slot, copies the rules and creates an order', async () => {
        const w = await world();
        const res = await book(w);
        expect(res.status).toBe('PENDING_PAYMENT');
        expect(res.razorpayOrderId).toBe('order_1');
        expect(res.amountPaise).toBe(50000);
        const c = await testDb.consultation.findUniqueOrThrow({ where: { id: res.consultationId } });
        expect(c.platformFeePaise).toBe(5000);
        expect((c.policySnapshot as any).holdMinutes).toBe(DEFAULT_RULES.holdMinutes);
        expect(razorpay.orders[0].notes).toMatchObject({ kind: 'consult', consultationId: c.id });
        expect(razorpay.orders[0].receipt).toBe(c.orderReceipt);
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: w.slot.id } })).status).toBe('BOOKED');
        expect(await testDb.consultationPayment.count({ where: { consultationId: c.id } })).toBe(1);
    });

    it('lets only one of two simultaneous patients hold a slot', async () => {
        const w = await world();
        const other = await makeUser();
        const otherPatient = await makePatient(other.id);
        const results = await Promise.allSettled([
            book(w, 'key-aaaaaaaa'),
            booking.createBooking({ userId: other.id, patientId: otherPatient.id, slotId: w.slot.id, idempotencyKey: 'key-bbbbbbbb' }, { razorpay }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({ status: 409 });
    });

    it('refuses a slot that starts too soon, a past slot, and a doctor who is not approved', async () => {
        const soon = await world(10);
        await expect(book(soon)).rejects.toMatchObject({ status: 400 });
        const past = await world(-30);
        await expect(book(past)).rejects.toMatchObject({ status: 400 });
        const w = await world();
        await testDb.doctorProfile.update({ where: { id: w.doctor.profile.id }, data: { status: 'SUSPENDED' } });
        await expect(book(w)).rejects.toMatchObject({ status: 404 });
    });

    it('holds for the shorter of the rule and the time left minus lead time', async () => {
        const now = new Date();
        const longWay = await world(24 * 60);
        const a = await book(longWay);
        expect(a.holdExpiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(DEFAULT_RULES.holdMinutes * 60_000 + 2000);
        const close = await world(20);
        const b = await book(close, 'key-closeslot');
        const expected = close.slot.startsAt.getTime() - DEFAULT_RULES.minLeadMinutes * 60_000;
        expect(Math.abs(b.holdExpiresAt.getTime() - expected)).toBeLessThan(1000);
    });

    it('expires a stale hold with no payment on the spot', async () => {
        const w = await world();
        const first = await book(w);
        await testDb.consultation.update({ where: { id: first.consultationId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
        const other = await makeUser();
        const otherPatient = await makePatient(other.id);
        const second = await booking.createBooking({ userId: other.id, patientId: otherPatient.id, slotId: w.slot.id, idempotencyKey: 'key-second11' }, { razorpay });
        expect(second.status).toBe('PENDING_PAYMENT');
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: first.consultationId } })).status).toBe('EXPIRED');
    });

    it('does not expire a stale hold whose payment was captured', async () => {
        const w = await world();
        const first = await book(w);
        await testDb.consultation.update({ where: { id: first.consultationId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
        razorpay.addPayment(first.razorpayOrderId!, { id: 'pay_1', status: 'captured' });
        const other = await makeUser();
        const otherPatient = await makePatient(other.id);
        await expect(
            booking.createBooking({ userId: other.id, patientId: otherPatient.id, slotId: w.slot.id, idempotencyKey: 'key-second22' }, { razorpay }),
        ).rejects.toMatchObject({ status: 409 });
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: first.consultationId } })).status).toBe('PENDING_PAYMENT');
    });

    it('reports the slot taken when Razorpay is unreachable while checking a stale hold', async () => {
        const w = await world();
        const first = await book(w);
        await testDb.consultation.update({ where: { id: first.consultationId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
        razorpay.unreachable = true;
        const other = await makeUser();
        const otherPatient = await makePatient(other.id);
        await expect(
            booking.createBooking({ userId: other.id, patientId: otherPatient.id, slotId: w.slot.id, idempotencyKey: 'key-second33' }, { razorpay }),
        ).rejects.toMatchObject({ status: 409 });
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: first.consultationId } })).status).toBe('PENDING_PAYMENT');
    });

    it('returns the same order for the same key and user, and refuses a different request on that key', async () => {
        const w = await world();
        const a = await book(w, 'key-repeat12');
        const b = await book(w, 'key-repeat12');
        expect(b.consultationId).toBe(a.consultationId);
        expect(razorpay.orders).toHaveLength(1);
        const slot2 = await makeSlot(w.doctor.profile.id, 2000);
        await expect(book({ ...w, slot: slot2 }, 'key-repeat12')).rejects.toMatchObject({ status: 409 });
    });

    it('treats the same key from another user as independent', async () => {
        const w = await world();
        await book(w, 'key-shared12');
        const other = await makeUser();
        const otherPatient = await makePatient(other.id);
        const slot2 = await makeSlot(w.doctor.profile.id, 2000);
        const res = await booking.createBooking({ userId: other.id, patientId: otherPatient.id, slotId: slot2.id, idempotencyKey: 'key-shared12' }, { razorpay });
        expect(res.status).toBe('PENDING_PAYMENT');
    });

    it('returns not found for a patient profile owned by someone else', async () => {
        const w = await world();
        const stranger = await makeUser();
        await expect(
            booking.createBooking({ userId: stranger.id, patientId: w.patient.id, slotId: w.slot.id, idempotencyKey: 'key-stranger' }, { razorpay }),
        ).rejects.toMatchObject({ status: 404 });
    });

    it('caps open holds per user and per doctor', async () => {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const s1 = await makeSlot(doctor.profile.id, 1500);
        const s2 = await makeSlot(doctor.profile.id, 1600);
        await book({ user, patient, slot: s1 }, 'key-cap-one1');
        await expect(book({ user, patient, slot: s2 }, 'key-cap-two2')).rejects.toMatchObject({ status: 429 });
        for (let i = 0; i < 2; i++) {
            const d = await makeDoctor();
            const s = await makeSlot(d.profile.id, 1500 + i);
            await book({ user, patient, slot: s }, `key-cap-more${i}`);
        }
        const d = await makeDoctor();
        const s = await makeSlot(d.profile.id, 1700);
        await expect(book({ user, patient, slot: s }, 'key-cap-over1')).rejects.toMatchObject({ status: 429 });
    });

    it('releases the hold when order creation fails', async () => {
        const w = await world();
        razorpay.failCreateOrder = true;
        await expect(book(w)).rejects.toMatchObject({ status: 502 });
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: w.slot.id } })).status).toBe('AVAILABLE');
        razorpay.failCreateOrder = false;
        await expect(book(w, 'key-retry1234')).resolves.toBeTruthy();
    });

    it('releases unpaid holds when a doctor is suspended but leaves paid consultations', async () => {
        const w = await world();
        const held = await book(w);
        const user2 = await makeUser();
        const patient2 = await makePatient(user2.id);
        const slot2 = await makeSlot(w.doctor.profile.id, 2000);
        const paid = await booking.createBooking({ userId: user2.id, patientId: patient2.id, slotId: slot2.id, idempotencyKey: 'key-paidone1' }, { razorpay });
        await testDb.consultation.update({ where: { id: paid.consultationId }, data: { status: 'CONFIRMED' } });
        const admin = await makeUser('SUPER_ADMIN');
        await service.reviewDoctor(admin.id, w.doctor.profile.id, 'SUSPENDED', 'test');
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: held.consultationId } })).status).toBe('EXPIRED');
        expect((await testDb.consultation.findUniqueOrThrow({ where: { id: paid.consultationId } })).status).toBe('CONFIRMED');
        // The freed slot is not offered again while the doctor is suspended, and the paid one stays booked.
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: w.slot.id } })).status).toBe('BLOCKED');
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot2.id } })).status).toBe('BOOKED');
    });

    it('keeps working hours and leave changes safe when an expired booking still points at a slot', async () => {
        const w = await world();
        const first = await book(w);
        await testDb.consultation.update({ where: { id: first.consultationId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
        await testDb.$transaction((tx) => import('./consultations.transitions').then((m) => m.expireHold(tx, first.consultationId)));
        await expect(service.setAvailability(w.doctor.profile.id, [{ dayOfWeek: 1, startMinute: 600, endMinute: 660 }])).resolves.toBeTruthy();
        const slot = await testDb.slot.findUniqueOrThrow({ where: { id: w.slot.id } });
        expect(slot.status).toBe('BLOCKED');
        await expect(service.addLeave(w.doctor.profile.id, new Date(Date.now() - 3600_000), new Date(Date.now() + 90 * 24 * 3600_000))).resolves.toBeTruthy();
    });

    it('refuses a replay of a booking that failed at Razorpay, and one still being set up', async () => {
        const w = await world();
        razorpay.failCreateOrder = true;
        await expect(book(w, 'key-replay-1234')).rejects.toMatchObject({ status: 502 });
        razorpay.failCreateOrder = false;
        await expect(book(w, 'key-replay-1234')).rejects.toMatchObject({ status: 409 });
        const fresh = await world();
        const held = await book(fresh, 'key-replay-5678');
        await testDb.consultationPayment.deleteMany({ where: { consultationId: held.consultationId } });
        await expect(book(fresh, 'key-replay-5678')).rejects.toMatchObject({ status: 409 });
    });

    it('keeps free slots that are still in the new hours and blocks the ones that fall outside', async () => {
        const { istDayStart } = await import('./slots');
        const w = await world();
        const dayStart = istDayStart(new Date(Date.now() + 2 * 86_400_000));
        const startsAt = new Date(dayStart.getTime() + 10 * 3_600_000);
        const dow = new Date(dayStart.getTime() + 330 * 60_000).getUTCDay();
        const slot = await testDb.slot.create({ data: { doctorId: w.doctor.profile.id, startsAt, endsAt: new Date(startsAt.getTime() + 15 * 60_000) } });
        const first = await booking.createBooking({ userId: w.user.id, patientId: w.patient.id, slotId: slot.id, idempotencyKey: 'key-keepslot12' }, { razorpay });
        await testDb.consultation.update({ where: { id: first.consultationId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
        await testDb.$transaction((tx) => import('./consultations.transitions').then((m) => m.expireHold(tx, first.consultationId)));
        await service.setAvailability(w.doctor.profile.id, [{ dayOfWeek: dow, startMinute: 600, endMinute: 615 }]);
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('AVAILABLE');
        await service.setAvailability(w.doctor.profile.id, [{ dayOfWeek: dow, startMinute: 700, endMinute: 715 }]);
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('BLOCKED');
        await service.setAvailability(w.doctor.profile.id, [{ dayOfWeek: dow, startMinute: 600, endMinute: 615 }]);
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('AVAILABLE');
    });

    describe('routes', () => {
        const post = (token: string | null, body: unknown, headers: Record<string, string> = {}) =>
            fetch(`${server.url}/consult/bookings`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
                body: JSON.stringify(body),
            });

        it('rejects a cookie request with the mobile header and no CSRF token', async () => {
            const w = await world();
            const res = await post(tokenFor(w.user as any), { slotId: w.slot.id, patientId: w.patient.id, idempotencyKey: 'key-csrf1234' }, {
                cookie: `docnow_access=${tokenFor(w.user as any)}`,
                'x-client-type': 'mobile',
            });
            expect(res.status).toBe(403);
            expect(await testDb.consultation.count()).toBe(0);
        });

        it('rejects bad ids and idempotency keys with 400, and no token with 401', async () => {
            const w = await world();
            expect((await post(tokenFor(w.user as any), { slotId: 'nope', patientId: w.patient.id, idempotencyKey: 'key-12345678' })).status).toBe(400);
            expect((await post(tokenFor(w.user as any), { slotId: w.slot.id, patientId: w.patient.id, idempotencyKey: 'short' })).status).toBe(400);
            expect((await post(null, {})).status).toBe(401);
        });

        it('returns another user\'s booking as not found', async () => {
            const w = await world();
            const created = await book(w);
            const stranger = await makeUser();
            const res = await fetch(`${server.url}/consult/bookings/${created.consultationId}`, { headers: { authorization: `Bearer ${tokenFor(stranger as any)}` } });
            expect(res.status).toBe(404);
            const mine = await fetch(`${server.url}/consult/bookings/${created.consultationId}`, { headers: { authorization: `Bearer ${tokenFor(w.user as any)}` } });
            expect(mine.status).toBe(200);
        });

        it('answers 502 and frees the slot when Razorpay is unavailable', async () => {
            const w = await world();
            const res = await post(tokenFor(w.user as any), { slotId: w.slot.id, patientId: w.patient.id, idempotencyKey: 'key-route123' });
            // No Razorpay credentials in tests, so order creation fails: the hold is released and 502 returned.
            expect(res.status).toBe(502);
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: w.slot.id } })).status).toBe('AVAILABLE');
            expect((await policy.getActivePolicy()).version).toBe(1);
        });
    });
});
