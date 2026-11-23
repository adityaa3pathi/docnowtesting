import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomInt } from 'crypto';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { useTestJwtSecret } from './test/http';

useTestJwtSecret();

/** Promo codes on consultations. Fee in these tests: ₹500. */
describeDb('consultation promo codes (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let cancel: typeof import('./consultations.cancellation');
    let transitions: typeof import('./consultations.transitions');
    let noShow: typeof import('./consultations.noShow');
    let promo: typeof import('./consultations.promo');
    let razorpay: FakeRazorpay;

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        cancel = await import('./consultations.cancellation');
        transitions = await import('./consultations.transitions');
        noShow = await import('./consultations.noShow');
        promo = await import('./consultations.promo');
    });
    afterAll(async () => {
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        await testDb.promoRedemption.deleteMany({ where: { consultationId: { not: null } } });
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    let n = 0;
    type Code = Partial<{ appliesTo: 'LAB' | 'CONSULT' | 'BOTH'; discountType: 'FLAT' | 'PERCENTAGE'; discountValue: number; maxDiscount: number; maxPerUser: number; maxRedemptions: number; minOrderValue: number; doctorIds: string[]; specialtyIds: string[] }>;
    async function code(o: Code = {}) {
        return testDb.promoCode.create({
            data: {
                code: `DOC${randomInt(100000, 999999)}`,
                appliesTo: o.appliesTo ?? 'CONSULT',
                discountType: o.discountType ?? 'PERCENTAGE',
                discountValue: o.discountValue ?? 20,
                maxDiscount: o.maxDiscount,
                maxPerUser: o.maxPerUser ?? 1,
                maxRedemptions: o.maxRedemptions,
                minOrderValue: o.minOrderValue ?? 0,
                scopes: { create: [...(o.doctorIds ?? []).map((doctorId) => ({ doctorId })), ...(o.specialtyIds ?? []).map((specialtyId) => ({ specialtyId }))] },
            },
        });
    }
    async function setup(hoursAhead = 30, wallet?: number) {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        if (wallet !== undefined) await testDb.wallet.create({ data: { userId: user.id, balance: wallet } });
        const slot = await makeSlot(doctor.profile.id, Math.round(hoursAhead * 60));
        return { doctor, user, patient, slot };
    }
    const book = (s: Awaited<ReturnType<typeof setup>>, promoCode?: string, extra: { useWallet?: boolean; key?: string } = {}) =>
        booking.createBooking({ userId: s.user.id, patientId: s.patient.id, slotId: s.slot.id, idempotencyKey: extra.key ?? `key-promo-${++n}-12345`, promoCode, useWallet: extra.useWallet }, { razorpay });
    const pay = (res: { razorpayOrderId: string | null; amountPaise: number }) =>
        payments.confirmPayment({ paymentId: `pay_p${String(++n).padStart(9, '0')}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
    const uses = async (promoCodeId: string) => ({
        count: (await testDb.promoCode.findUniqueOrThrow({ where: { id: promoCodeId } })).redeemedCount,
        rows: await testDb.promoRedemption.count({ where: { promoCodeId } }),
    });
    const row = (id: string) => testDb.consultation.findUniqueOrThrow({ where: { id }, include: { promoRedemption: true, refunds: true } });

    describe('discount', () => {
        it('takes 20% off: Razorpay asked for ₹400, the fee stays ₹500, one use recorded', async () => {
            const s = await setup();
            const p = await code();
            const res = await book(s, p.code.toLowerCase());
            expect(res).toMatchObject({ feePaise: 50000, discountPaise: 10000, amountPaise: 40000 });
            expect(razorpay.orders[0].amountPaise).toBe(40000);
            const c = await row(res.consultationId);
            expect(c).toMatchObject({ feePaise: 50000, discountPaise: 10000, promoCodeId: p.id, platformFeePaise: c.platformFeePaise });
            expect(c.promoRedemption?.userId).toBe(s.user.id);
            expect(await uses(p.id)).toEqual({ count: 1, rows: 1 });
            expect(await pay(res)).toBe('confirmed');
            expect((await booking.getBooking(s.user.id, res.consultationId)).promoCode).toBe(p.code);
        });

        it('caps a percentage at the maximum discount, and works in whole paise', () => {
            expect(promo.consultDiscountPaise({ discountType: 'PERCENTAGE', discountValue: 50, maxDiscount: 100 }, 50000)).toBe(10000);
            expect(promo.consultDiscountPaise({ discountType: 'PERCENTAGE', discountValue: 12.5, maxDiscount: null }, 39999)).toBe(5000);
            expect(promo.consultDiscountPaise({ discountType: 'FLAT', discountValue: 999, maxDiscount: null }, 50000)).toBe(50000);
        });

        it('combines with the wallet: the wallet covers what is left after the discount', async () => {
            const s = await setup(30, 300);
            const p = await code();
            const res = await book(s, p.code, { useWallet: true });
            expect(res).toMatchObject({ discountPaise: 10000, walletPaise: 30000, amountPaise: 10000 });
        });

        it('a code that makes it free confirms at once with nothing to pay', async () => {
            const s = await setup();
            const p = await code({ discountType: 'FLAT', discountValue: 600 });
            const res = await book(s, p.code);
            expect(res).toMatchObject({ status: 'CONFIRMED', amountPaise: 0, discountPaise: 50000, razorpayOrderId: null });
            expect(razorpay.orders).toHaveLength(0);
            expect((await row(res.consultationId)).confirmingPaymentId).toBe(`free:${res.consultationId}`);
        });

        it('a repeated booking call with the same key does not use the code twice', async () => {
            const s = await setup();
            const p = await code({ maxPerUser: 5 });
            const a = await book(s, p.code, { key: 'key-promo-repeat-1' });
            const b = await book(s, p.code, { key: 'key-promo-repeat-1' });
            expect(b.consultationId).toBe(a.consultationId);
            expect(await uses(p.id)).toEqual({ count: 1, rows: 1 });
        });
    });

    describe('review fixes', () => {
        it('a discount never leaves the card under ₹1: it takes ₹1 less', async () => {
            expect(promo.consultDiscountPaise({ discountType: 'PERCENTAGE', discountValue: 99.9, maxDiscount: null }, 50000)).toBe(49900);
            const s = await setup();
            const p = await code({ discountType: 'FLAT', discountValue: 499.5 });
            const res = await book(s, p.code);
            expect(res).toMatchObject({ discountPaise: 49900, amountPaise: 100 });
            expect(razorpay.orders[0].amountPaise).toBe(100);
        });

        it('refuses, and takes nothing, when the discount differs from what the patient was shown', async () => {
            const s = await setup();
            const p = await code();
            await expect(booking.createBooking({ userId: s.user.id, patientId: s.patient.id, slotId: s.slot.id, idempotencyKey: 'key-promo-shown-1', promoCode: p.code, expectedDiscountPaise: 5000 }, { razorpay }))
                .rejects.toMatchObject({ status: 409, message: booking.PROMO_CHANGED });
            expect(await uses(p.id)).toEqual({ count: 0, rows: 0 });
            await expect(booking.createBooking({ userId: s.user.id, patientId: s.patient.id, slotId: s.slot.id, idempotencyKey: 'key-promo-shown-2', promoCode: p.code, expectedDiscountPaise: 10000 }, { razorpay }))
                .resolves.toMatchObject({ discountPaise: 10000 });
        });

        it('codes with other characters an admin may use still work', async () => {
            const s = await setup();
            const p = await testDb.promoCode.create({ data: { code: `NEW.USER ${randomInt(1000, 9999)}`, appliesTo: 'CONSULT', discountType: 'FLAT', discountValue: 50 } });
            await expect(promo.checkConsultPromo(s.user.id, p.code.toLowerCase(), s.slot.id, testDb)).resolves.toMatchObject({ discountPaise: 5000 });
            await expect(book(s, p.code)).resolves.toMatchObject({ discountPaise: 5000 });
        });

        it('the offer list is not crowded out by codes for other doctors', async () => {
            const s = await setup();
            const other = await makeDoctor();
            const fits = await code();
            for (let i = 0; i < 110; i++) await code({ doctorIds: [other.profile.id] });
            const list = await promo.availableConsultPromos(s.user.id, s.doctor.profile.id, testDb);
            expect(list.map((p) => p.code)).toContain(fits.code);
        });
    });

    describe('who and where the code works', () => {
        it('refuses lab-only codes, unknown codes and expired ones, and holds nothing', async () => {
            const s = await setup();
            const lab = await code({ appliesTo: 'LAB' });
            await expect(book(s, lab.code)).rejects.toMatchObject({ status: 400, message: 'This promo code is for lab tests, not consultations' });
            await expect(book(s, 'NOPE123')).rejects.toMatchObject({ status: 400 });
            const old = await code();
            await testDb.promoCode.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
            await expect(book(s, old.code)).rejects.toMatchObject({ status: 400, message: 'This promo code has expired' });
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: s.slot.id } })).status).toBe('AVAILABLE');
            expect(await testDb.consultation.count()).toBe(0);
        });

        it('a BOTH code works for consultations', async () => {
            const s = await setup();
            const p = await code({ appliesTo: 'BOTH' });
            await expect(book(s, p.code)).resolves.toMatchObject({ discountPaise: 10000 });
        });

        it('a code limited to another doctor is refused; to this doctor or their specialty, accepted', async () => {
            const s = await setup();
            const other = await makeDoctor();
            const elsewhere = await testDb.specialty.upsert({ where: { name: 'Other Specialty' }, update: {}, create: { name: 'Other Specialty', slug: 'other-specialty' } });
            const wrongDoctor = await code({ doctorIds: [other.profile.id] });
            const wrongSpecialty = await code({ specialtyIds: [elsewhere.id] });
            await expect(book(s, wrongDoctor.code)).rejects.toMatchObject({ status: 400, message: 'This promo code does not apply to this doctor' });
            await expect(book(s, wrongSpecialty.code)).rejects.toMatchObject({ status: 400 });
            const bySpecialty = await code({ specialtyIds: [s.doctor.profile.specialtyId] });
            await expect(book(s, bySpecialty.code)).resolves.toMatchObject({ discountPaise: 10000 });
        });

        it('the per-user limit counts lab and consultation uses together', async () => {
            const s = await setup();
            const p = await code({ appliesTo: 'BOTH', maxPerUser: 1 });
            await testDb.promoRedemption.create({ data: { userId: s.user.id, promoCodeId: p.id } }); // a lab use
            await expect(book(s, p.code)).rejects.toMatchObject({ status: 400, message: 'You have already used this promo code' });
        });

        it('two tabs cannot both take the last use', async () => {
            const doctorA = await makeDoctor();
            const doctorB = await makeDoctor();
            const user = await makeUser();
            const patient = await makePatient(user.id);
            const p = await code({ maxPerUser: 1 });
            const slots = await Promise.all([makeSlot(doctorA.profile.id, 30 * 60), makeSlot(doctorB.profile.id, 30 * 60)]);
            const results = await Promise.allSettled(slots.map((slot, i) =>
                booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-promo-tabs-${i}-1`, promoCode: p.code }, { razorpay })));
            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            expect(await uses(p.id)).toEqual({ count: 1, rows: 1 });
        });

        it('two patients cannot both take a code\'s last use', async () => {
            const p = await code({ maxRedemptions: 1, maxPerUser: 1 });
            const [a, b] = await Promise.all([setup(), setup()]);
            const results = await Promise.allSettled([book(a, p.code), book(b, p.code)]);
            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            expect(await uses(p.id)).toEqual({ count: 1, rows: 1 });
        });

        it('the Apply check and the list follow the same rules and use nothing', async () => {
            const s = await setup();
            const ok = await code();
            const other = await makeDoctor();
            const notHere = await code({ doctorIds: [other.profile.id] });
            const labOnly = await code({ appliesTo: 'LAB' });
            await expect(promo.checkConsultPromo(s.user.id, ok.code, s.slot.id, testDb)).resolves.toMatchObject({ code: ok.code, discountPaise: 10000, feePaise: 50000 });
            await expect(promo.checkConsultPromo(s.user.id, notHere.code, s.slot.id, testDb)).rejects.toMatchObject({ status: 400 });
            const list = await promo.availableConsultPromos(s.user.id, s.doctor.profile.id, testDb);
            const codes = list.map((p) => p.code);
            expect(codes).toContain(ok.code);
            expect(codes).not.toContain(notHere.code);
            expect(codes).not.toContain(labOnly.code);
            expect(await uses(ok.id)).toEqual({ count: 0, rows: 0 });
        });
    });

    describe('giving the use back', () => {
        it('an unpaid hold that ends gives it back; a late payment takes it again', async () => {
            const s = await setup();
            const p = await code({ maxRedemptions: 1 });
            const res = await book(s, p.code);
            await testDb.consultation.update({ where: { id: res.consultationId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
            await testDb.$transaction((tx) => transitions.expireHold(tx, res.consultationId));
            expect(await uses(p.id)).toEqual({ count: 0, rows: 0 });
            expect(await pay(res)).toBe('reclaimed');
            expect(await uses(p.id)).toEqual({ count: 1, rows: 1 });
        });

        it('cancelling before paying gives it back', async () => {
            const s = await setup();
            const p = await code();
            const res = await book(s, p.code);
            await cancel.cancelConsultation(res.consultationId, { kind: 'booker', userId: s.user.id }, undefined, { razorpay });
            expect(await uses(p.id)).toEqual({ count: 0, rows: 0 });
        });

        it('a full refund (more than a day out) gives it back; a 50% refund keeps it used', async () => {
            const full = await setup(30);
            const half = await setup(10);
            const p = await code({ maxPerUser: 1 });
            const a = await book(full, p.code);
            const b = await book(half, p.code);
            await pay(a);
            await pay(b);
            await cancel.cancelConsultation(a.consultationId, { kind: 'booker', userId: full.user.id }, undefined, { razorpay });
            await cancel.cancelConsultation(b.consultationId, { kind: 'booker', userId: half.user.id }, undefined, { razorpay });
            expect((await row(a.consultationId)).promoRedemption).toBeNull();
            expect((await row(b.consultationId)).promoRedemption).not.toBeNull();
            expect(await uses(p.id)).toEqual({ count: 1, rows: 1 });
            // The 50% refund is of what was paid (₹400 after the discount).
            expect((await row(b.consultationId)).refunds.map((r) => r.amountPaise)).toEqual([20000]);
        });

        it('a doctor no-show gives it back', async () => {
            const s = await setup();
            const p = await code();
            const res = await book(s, p.code);
            await pay(res);
            await testDb.consultation.update({ where: { id: res.consultationId }, data: { startsAt: new Date(Date.now() - 30 * 60_000) } });
            await noShow.settleNoShows({ razorpay, now: new Date() });
            expect((await row(res.consultationId)).status).toBe('REFUNDED');
            expect(await uses(p.id)).toEqual({ count: 0, rows: 0 });
        });

        it('a free booking can be cancelled; nothing to refund, the use comes back', async () => {
            const s = await setup();
            const p = await code({ discountType: 'FLAT', discountValue: 500 });
            const res = await book(s, p.code);
            const preview = await cancel.cancelPreview(s.user.id, res.consultationId, { razorpay });
            expect(preview).toMatchObject({ paidPaise: 0, refundPaise: 0 });
            const out = await cancel.cancelConsultation(res.consultationId, { kind: 'booker', userId: s.user.id }, undefined, { razorpay });
            expect(out).toMatchObject({ status: 'CANCELLED', refundPaise: 0 });
            expect(await uses(p.id)).toEqual({ count: 0, rows: 0 });
        });
    });
});
