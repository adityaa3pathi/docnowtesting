import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { useTestJwtSecret } from './test/http';
import { RazorpayError } from './consultations.razorpay';

useTestJwtSecret();

/** Consultations paid from the DocNow wallet, alone or with a card. Fee in these tests: ₹500. */
describeDb('wallet payments for consultations (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let cancel: typeof import('./consultations.cancellation');
    let transitions: typeof import('./consultations.transitions');
    let noShow: typeof import('./consultations.noShow');
    let reconciler: typeof import('../../workers/consultReconciler');
    let razorpay: FakeRazorpay;

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        cancel = await import('./consultations.cancellation');
        transitions = await import('./consultations.transitions');
        noShow = await import('./consultations.noShow');
        reconciler = await import('../../workers/consultReconciler');
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

    let n = 0;
    async function setup(walletRupees: number, hoursAhead = 30) {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        await testDb.wallet.create({ data: { userId: user.id, balance: walletRupees } });
        const slot = await makeSlot(doctor.profile.id, Math.round(hoursAhead * 60));
        return { doctor, user, patient, slot };
    }
    const book = (s: Awaited<ReturnType<typeof setup>>, useWallet = true, key = `key-wallet-${++n}-12345`) =>
        booking.createBooking({ userId: s.user.id, patientId: s.patient.id, slotId: s.slot.id, idempotencyKey: key, useWallet }, { razorpay });
    const balance = async (userId: string) => (await testDb.wallet.findUniqueOrThrow({ where: { userId } })).balance;
    const ledger = async (userId: string) =>
        testDb.walletLedger.findMany({ where: { wallet: { userId } }, orderBy: { createdAt: 'asc' }, select: { type: true, amount: true, referenceType: true, balanceAfter: true } });
    const consultation = (id: string) => testDb.consultation.findUniqueOrThrow({ where: { id }, include: { payments: true, refunds: { include: { payment: true } } } });
    const walletPart = async (id: string) => (await consultation(id)).payments.find((p) => p.source === 'WALLET');
    const pay = (res: { razorpayOrderId: string | null; amountPaise: number }, paymentId = `pay_w${String(++n).padStart(9, '0')}`) =>
        payments.confirmPayment({ paymentId, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
    const expire = async (id: string) => {
        await testDb.consultation.update({ where: { id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
        return testDb.$transaction((tx) => transitions.expireHold(tx, id));
    };

    describe('booking', () => {
        it('takes what the wallet covers with the hold and asks Razorpay only for the rest', async () => {
            const s = await setup(200);
            const res = await book(s);
            expect(res).toMatchObject({ status: 'PENDING_PAYMENT', feePaise: 50000, walletPaise: 20000, amountPaise: 30000 });
            expect(razorpay.orders).toHaveLength(1);
            expect(razorpay.orders[0].amountPaise).toBe(30000);
            expect(await balance(s.user.id)).toBe(0);
            expect(await ledger(s.user.id)).toEqual([{ type: 'DEBIT', amount: -200, referenceType: 'CONSULT', balanceAfter: 0 }]);
            expect((await walletPart(res.consultationId))?.status).toBe('CREATED');

            expect(await pay(res)).toBe('confirmed');
            expect((await walletPart(res.consultationId))?.status).toBe('CAPTURED');
            expect((await consultation(res.consultationId)).status).toBe('CONFIRMED');
        });

        it('confirms at once, with no Razorpay order, when the wallet covers the whole fee', async () => {
            const s = await setup(750.5);
            const res = await book(s);
            expect(res).toMatchObject({ status: 'CONFIRMED', razorpayOrderId: null, amountPaise: 0, walletPaise: 50000 });
            expect(razorpay.orders).toHaveLength(0);
            expect(await balance(s.user.id)).toBe(250.5);
            const c = await consultation(res.consultationId);
            expect(c.confirmingPaymentId).toMatch(/^wallet:/);
            expect(c.payments).toHaveLength(1);
            expect(c.payments[0]).toMatchObject({ source: 'WALLET', status: 'CAPTURED', amountPaise: 50000, razorpayOrderId: null });
        });

        it('a repeated wallet-only booking call returns the same booking and takes nothing more', async () => {
            const s = await setup(600);
            const first = await book(s, true, 'key-wallet-repeat-1');
            const again = await book(s, true, 'key-wallet-repeat-1');
            expect(again).toMatchObject({ consultationId: first.consultationId, status: 'CONFIRMED' });
            expect(await balance(s.user.id)).toBe(100);
            expect(await ledger(s.user.id)).toHaveLength(1);
        });

        it('the wallet choice is part of the request: the same key with a different choice is refused', async () => {
            const s = await setup(100);
            await book(s, true, 'key-wallet-choice-1');
            await expect(book(s, false, 'key-wallet-choice-1')).rejects.toMatchObject({ status: 409 });
        });

        it('without the wallet switch, the wallet is left alone', async () => {
            const s = await setup(300);
            const res = await book(s, false);
            expect(res).toMatchObject({ amountPaise: 50000, walletPaise: 0 });
            expect(await balance(s.user.id)).toBe(300);
            expect(await walletPart(res.consultationId)).toBeUndefined();
        });

        it('works in whole paise for a float balance', async () => {
            const s = await setup(0.1 + 0.2); // 0.30000000000000004
            const res = await book(s);
            expect(res).toMatchObject({ walletPaise: 30, amountPaise: 49970 });
            expect(await balance(s.user.id)).toBe(0);
        });

        it('two tabs spending the same balance at once never take more than it holds', async () => {
            const doctorA = await makeDoctor();
            const doctorB = await makeDoctor();
            const user = await makeUser();
            const patient = await makePatient(user.id);
            await testDb.wallet.create({ data: { userId: user.id, balance: 500 } });
            const [slotA, slotB] = await Promise.all([makeSlot(doctorA.profile.id, 30 * 60), makeSlot(doctorB.profile.id, 30 * 60)]);
            const results = await Promise.allSettled([slotA, slotB].map((slot, i) =>
                booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-two-tabs-${i}-123`, useWallet: true }, { razorpay })));
            const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
            expect(ok.length).toBeGreaterThanOrEqual(1);
            for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ status: 409 });
            expect(ok.reduce((sum, r) => sum + r.walletPaise, 0)).toBe(50000);
            expect(await balance(user.id)).toBe(0);
            const debits = await testDb.walletLedger.aggregate({ where: { wallet: { userId: user.id } }, _sum: { amount: true } });
            expect(debits._sum.amount).toBe(-500);
        });
    });

    describe('review fixes', () => {
        it('never leaves the card a share under ₹1: the wallet takes ₹1 less', async () => {
            const s = await setup(499.5);
            const res = await book(s);
            expect(res).toMatchObject({ walletPaise: 49900, amountPaise: 100 });
            expect(razorpay.orders[0].amountPaise).toBe(100);
            expect(await balance(s.user.id)).toBe(0.5);
        });

        it('refuses, and takes nothing, when the wallet amount differs from what the patient was shown', async () => {
            const s = await setup(300);
            await expect(booking.createBooking({ userId: s.user.id, patientId: s.patient.id, slotId: s.slot.id, idempotencyKey: 'key-wallet-shown-1', useWallet: true, expectedWalletPaise: 10000 }, { razorpay }))
                .rejects.toMatchObject({ status: 409, message: booking.WALLET_CHANGED });
            expect(await balance(s.user.id)).toBe(300);
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: s.slot.id } })).status).toBe('AVAILABLE');
            const ok = await booking.createBooking({ userId: s.user.id, patientId: s.patient.id, slotId: s.slot.id, idempotencyKey: 'key-wallet-shown-2', useWallet: true, expectedWalletPaise: 30000 }, { razorpay });
            expect(ok).toMatchObject({ walletPaise: 30000, amountPaise: 20000 });
        });

        it('a card refund Razorpay rejects keeps the booking cancelled, not refunded, until staff retry it', async () => {
            const s = await setup(200, 30);
            const res = await book(s);
            await pay(res);
            razorpay.refundScript = [new RazorpayError('api', 'bad request', 400)];
            await cancel.cancelConsultation(res.consultationId, { kind: 'booker', userId: s.user.id }, undefined, { razorpay });
            expect(await balance(s.user.id)).toBe(200);
            let c = await consultation(res.consultationId);
            expect(c.status).toBe('CANCELLED');
            const card = c.refunds.find((r) => r.payment.source === 'RAZORPAY')!;
            expect(card.status).toBe('FAILED');
            const refunds = await import('./consultations.refunds');
            expect(await refunds.reopenRefund(testDb, card.id)).toBe(true);
            expect(await refunds.runRefund(card.id, { db: testDb, razorpay })).toBe('processed');
            c = await consultation(res.consultationId);
            expect(c.status).toBe('REFUNDED');
        });

        it('both parts finishing at the same moment still end the booking refunded', async () => {
            for (let i = 0; i < 3; i++) {
                const s = await setup(200, 30);
                const res = await book(s);
                await pay(res);
                razorpay.refundStatus = 'pending';
                const parts = await testDb.$transaction(async (tx) => {
                    await tx.consultation.update({ where: { id: res.consultationId }, data: { status: 'CANCELLED' } });
                    await tx.slot.update({ where: { id: s.slot.id }, data: { status: 'AVAILABLE' } });
                    const c = await tx.consultation.findUniqueOrThrow({ where: { id: res.consultationId }, include: { payments: true } });
                    return Promise.all(c.payments.map((p, k) => tx.consultationRefund.create({
                        data: { consultationId: c.id, paymentId: p.id, reason: 'PATIENT_CANCEL', amountPaise: p.amountPaise, receipt: `rf_race_${i}_${k}_${p.id.slice(0, 6)}` },
                    })));
                });
                const refunds = await import('./consultations.refunds');
                await Promise.all(parts.map((r) => testDb.$transaction((tx) => refunds.markRefundProcessed(tx, r.id))));
                expect((await consultation(res.consultationId)).status).toBe('REFUNDED');
            }
        });

        it('a card refund share under ₹1 goes to the wallet instead', () => {
            const split = cancel.splitRefund([
                { source: 'RAZORPAY' as const, amountPaise: 500 },
                { source: 'WALLET' as const, amountPaise: 49500 },
            ], 10);
            expect(split.map((s) => s.refundPaise)).toEqual([0, 5000]);
        });

        it('a wallet refund that keeps failing reaches the staff queue after the usual attempts', async () => {
            const s = await setup(500, 30);
            const res = await book(s);
            const part = (await walletPart(res.consultationId))!;
            await testDb.consultation.update({ where: { id: res.consultationId }, data: { status: 'CANCELLED' } });
            await testDb.slot.update({ where: { id: s.slot.id }, data: { status: 'AVAILABLE' } });
            const r = await testDb.consultationRefund.create({ data: { consultationId: res.consultationId, paymentId: part.id, reason: 'PATIENT_CANCEL', amountPaise: 50000, receipt: 'rf_broken_wallet_1' } });
            const broken = new Proxy(testDb, { get: (t, k) => (k === '$transaction' ? () => Promise.reject(new Error('db down')) : Reflect.get(t, k)) });
            const refunds = await import('./consultations.refunds');
            const outcomes = [];
            for (let i = 0; i < refunds.MAX_REFUND_ATTEMPTS + 1; i++) outcomes.push(await refunds.runRefund(r.id, { db: broken as typeof testDb, razorpay }));
            expect(outcomes.slice(-2)).toEqual(['failed', 'skipped']);
            expect(await testDb.consultationRefund.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'FAILED', lastError: 'db down' });
            expect(await refunds.reopenRefund(testDb, r.id)).toBe(true);
            expect(await refunds.runRefund(r.id, { db: testDb, razorpay })).toBe('processed');
            expect(await balance(s.user.id)).toBe(500);
        });
    });

    describe('holds that end unpaid', () => {
        it('expiry gives the wallet part back, once', async () => {
            const s = await setup(200);
            const res = await book(s);
            expect(await expire(res.consultationId)).toBe(true);
            expect(await expire(res.consultationId)).toBe(false);
            expect(await balance(s.user.id)).toBe(200);
            expect((await ledger(s.user.id)).map((l) => l.referenceType).sort()).toEqual(['CONSULT', 'CONSULT_RELEASE']);
            expect((await walletPart(res.consultationId))?.status).toBe('RELEASED');
        });

        it('the reconciler expiring a lapsed hold gives the wallet part back', async () => {
            const s = await setup(200);
            const res = await book(s);
            await testDb.consultation.update({ where: { id: res.consultationId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
            await reconciler.runConsultCycle({ razorpay, alert: () => {} });
            expect((await consultation(res.consultationId)).status).toBe('EXPIRED');
            expect(await balance(s.user.id)).toBe(200);
        });

        it('cancelling before paying gives the wallet part back', async () => {
            const s = await setup(200);
            const res = await book(s);
            await cancel.cancelConsultation(res.consultationId, { kind: 'booker', userId: s.user.id }, undefined, { razorpay });
            expect(await balance(s.user.id)).toBe(200);
        });

        it('a Razorpay order failure releases the hold and the wallet part', async () => {
            const s = await setup(200);
            razorpay.failCreateOrder = true;
            await expect(book(s)).rejects.toMatchObject({ status: 502 });
            expect(await balance(s.user.id)).toBe(200);
        });

        it('a late card payment takes the wallet part again and keeps the booking', async () => {
            const s = await setup(200);
            const res = await book(s);
            await expire(res.consultationId);
            expect(await pay(res)).toBe('reclaimed');
            expect(await balance(s.user.id)).toBe(0);
            expect((await ledger(s.user.id)).map((l) => l.referenceType).sort()).toEqual(['CONSULT', 'CONSULT_REDEBIT', 'CONSULT_RELEASE']);
            expect((await walletPart(res.consultationId))?.status).toBe('CAPTURED');
        });

        it('a late card payment after the wallet was spent refunds the card and leaves the wallet alone', async () => {
            const s = await setup(200);
            const res = await book(s);
            await expire(res.consultationId);
            await testDb.wallet.update({ where: { userId: s.user.id }, data: { balance: 50 } });
            expect(await pay(res)).toBe('refund_created');
            const c = await consultation(res.consultationId);
            expect(c.status).toBe('EXPIRED');
            expect(c.refunds.map((r) => [r.reason, r.amountPaise])).toEqual([['LATE_PAYMENT_SLOT_LOST', 30000]]);
            expect(await balance(s.user.id)).toBe(50);
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: s.slot.id } })).status).toBe('AVAILABLE');
        });

        it('a replayed payment notice confirms once and takes the wallet once', async () => {
            const s = await setup(200);
            const res = await book(s);
            expect(await pay(res, 'pay_replay000001')).toBe('confirmed');
            expect(await pay(res, 'pay_replay000001')).toBe('already');
            expect(await ledger(s.user.id)).toHaveLength(1);
        });

        it('expects the card part, not the full fee, from Razorpay', async () => {
            const s = await setup(200);
            const res = await book(s);
            const out = await payments.confirmPayment({ paymentId: 'pay_fullfee00001', orderId: res.razorpayOrderId!, amountPaise: 50000, currency: 'INR' });
            expect(out).toBe('flagged');
        });
    });

    describe('refunds', () => {
        async function paidMixed(hoursAhead: number) {
            const s = await setup(200, hoursAhead);
            const res = await book(s);
            await pay(res);
            return { ...s, id: res.consultationId };
        }

        it('a 50% cancel gives half of each part back: ₹100 to the wallet, ₹150 to the card', async () => {
            const s = await paidMixed(10);
            const preview = await cancel.cancelPreview(s.user.id, s.id, { razorpay });
            expect(preview).toMatchObject({ percent: 50, paidPaise: 50000, walletPaidPaise: 20000, refundPaise: 25000, walletRefundPaise: 10000 });
            const out = await cancel.cancelConsultation(s.id, { kind: 'booker', userId: s.user.id }, undefined, { razorpay });
            expect(out).toMatchObject({ refundPaise: 25000, walletRefundPaise: 10000 });
            expect(razorpay.refunds.map((r) => r.amount)).toEqual([15000]);
            expect(await balance(s.user.id)).toBe(100);
            const c = await consultation(s.id);
            expect(c.refunds.map((r) => [r.payment.source, r.amountPaise, r.status]).sort()).toEqual([['RAZORPAY', 15000, 'PROCESSED'], ['WALLET', 10000, 'PROCESSED']]);
            expect(c.status).toBe('REFUNDED');
        });

        it('stays cancelled, not refunded, while the card part is still on its way', async () => {
            const s = await paidMixed(30);
            razorpay.refundStatus = 'pending';
            await cancel.cancelConsultation(s.id, { kind: 'booker', userId: s.user.id }, undefined, { razorpay });
            expect(await balance(s.user.id)).toBe(200);
            const c = await consultation(s.id);
            expect(c.status).toBe('CANCELLED');
            const view = await booking.getBooking(s.user.id, s.id);
            expect(view).toMatchObject({ refundPaise: 50000, walletRefundPaise: 20000, refundStatus: 'PENDING' });
        });

        it('cancelling a wallet-only booking puts everything back in the wallet, once', async () => {
            const s = await setup(500, 30);
            const res = await book(s);
            await cancel.cancelConsultation(res.consultationId, { kind: 'booker', userId: s.user.id }, undefined, { razorpay });
            await cancel.cancelConsultation(res.consultationId, { kind: 'booker', userId: s.user.id }, undefined, { razorpay });
            expect(razorpay.refundCalls).toBe(0);
            expect(await balance(s.user.id)).toBe(500);
            expect((await consultation(res.consultationId)).status).toBe('REFUNDED');
            expect((await ledger(s.user.id)).map((l) => l.referenceType).sort()).toEqual(['CONSULT', 'CONSULT_REFUND']);
        });

        it('a doctor no-show refunds both parts in full', async () => {
            const s = await paidMixed(30);
            const startsAt = new Date(Date.now() - 30 * 60_000);
            await testDb.consultation.update({ where: { id: s.id }, data: { startsAt } });
            await noShow.settleNoShows({ razorpay, now: new Date() });
            const c = await consultation(s.id);
            expect(c.status).toBe('REFUNDED');
            expect(c.refunds.map((r) => [r.payment.source, r.amountPaise]).sort()).toEqual([['RAZORPAY', 30000], ['WALLET', 20000]]);
            expect(await balance(s.user.id)).toBe(200);
        });

        it('a wallet refund left pending (a crash) is finished by the reconciler, without crediting twice', async () => {
            const s = await setup(500, 30);
            const res = await book(s);
            const part = (await walletPart(res.consultationId))!;
            await testDb.$transaction(async (tx) => {
                await tx.consultation.update({ where: { id: res.consultationId }, data: { status: 'CANCELLED' } });
                await tx.slot.update({ where: { id: s.slot.id }, data: { status: 'AVAILABLE' } });
                await tx.consultationRefund.create({
                    data: { consultationId: res.consultationId, paymentId: part.id, reason: 'PATIENT_CANCEL', amountPaise: 50000, receipt: 'rf_crash_test_1', updatedAt: new Date(Date.now() - 5 * 60_000) },
                });
            });
            await reconciler.runConsultCycle({ razorpay, alert: () => {} });
            await reconciler.runConsultCycle({ razorpay, alert: () => {} });
            expect(await balance(s.user.id)).toBe(500);
            expect((await consultation(res.consultationId)).status).toBe('REFUNDED');
        });
    });
});
