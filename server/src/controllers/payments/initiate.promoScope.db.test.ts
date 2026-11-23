import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { describeDb, makeAddress, makeCartWithItem, makePromo, makeUser, resetCommerceData, testDb } from '../../test/db';
import { postJson, serve, tokenFor, useTestJwtSecret } from '../../test/http';

useTestJwtSecret();

const m = vi.hoisted(() => ({ orderCreate: vi.fn(), finalize: vi.fn() }));
vi.mock('../../services/razorpay', () => ({ getRazorpay: () => ({ orders: { create: m.orderCreate }, payments: { refund: vi.fn() } }) }));
vi.mock('../../services/bookingFinalization', () => ({ finalizeBooking: m.finalize, syncManagerOrder: vi.fn() }));
vi.mock('../../utils/referralService', () => ({ tryAwardFirstOrderBonus: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

const { default: paymentsRouter } = await import('../../routes/payments');
const { default: promosRouter } = await import('../../routes/promos');

let app: Awaited<ReturnType<typeof serve>>;
let promoApp: Awaited<ReturnType<typeof serve>>;

/** Promo codes made only for consultations never touch live lab checkout (P6). */
describeDb('lab checkout and consultation-only promo codes (real Postgres)', () => {
    beforeEach(async () => {
        await resetCommerceData();
        m.orderCreate.mockReset().mockResolvedValue({ id: 'order_test_1' });
        m.finalize.mockReset().mockResolvedValue({ status: 'success' });
        app = app || (await serve('/payments', paymentsRouter));
        promoApp = promoApp || (await serve('/promos', promosRouter));
    });
    afterAll(async () => {
        await app?.close();
        await promoApp?.close();
        await testDb?.$disconnect();
    });

    async function cartWith(appliesTo: 'LAB' | 'CONSULT' | 'BOTH') {
        const user = await makeUser();
        const address = await makeAddress(user.id);
        await makeCartWithItem(user.id, { price: 1000 });
        const promo = await makePromo({ discountValue: 100 });
        await testDb.promoCode.update({ where: { id: promo.id }, data: { appliesTo } });
        return { user, address, promo, token: tokenFor(user as any) };
    }

    it('existing codes are LAB by default and keep working at lab checkout', async () => {
        const promo = await makePromo();
        expect(promo.appliesTo).toBe('LAB');
        const { address, token, promo: lab } = await cartWith('LAB');
        const res = await postJson(`${app.url}/payments/initiate`, { slot_id: 'stm_1', addressId: address.id, promoCode: lab.code }, token);
        expect(res.status).toBe(200);
        expect(await testDb.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } })).toMatchObject({ discountAmount: 100 });
    });

    it('lab checkout refuses a consultation-only code and books nothing', async () => {
        const { address, token, promo } = await cartWith('CONSULT');
        const res = await postJson(`${app.url}/payments/initiate`, { slot_id: 'stm_1', addressId: address.id, promoCode: promo.code }, token);
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('This promo code is for doctor consultations only');
        expect(await testDb.booking.count()).toBe(0);
        expect((await testDb.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).redeemedCount).toBe(0);
    });

    it('a BOTH code works at lab checkout', async () => {
        const { address, token, promo } = await cartWith('BOTH');
        const res = await postJson(`${app.url}/payments/initiate`, { slot_id: 'stm_1', addressId: address.id, promoCode: promo.code }, token);
        expect(res.status).toBe(200);
    });

    it('the per-user limit is maxPerUser, counting consultation uses too', async () => {
        const { user, address, token, promo } = await cartWith('BOTH');
        await testDb.promoCode.update({ where: { id: promo.id }, data: { maxPerUser: 2 } });
        await testDb.promoRedemption.create({ data: { userId: user.id, promoCodeId: promo.id } }); // e.g. a consultation use
        const ok = await postJson(`${app.url}/payments/initiate`, { slot_id: 'stm_1', addressId: address.id, promoCode: promo.code }, token);
        expect(ok.status).toBe(200);
        // Another user who already used it twice (lab and consultation) is refused.
        const other = await cartWith('BOTH');
        await testDb.promoRedemption.createMany({ data: [{ userId: other.user.id, promoCodeId: promo.id }, { userId: other.user.id, promoCodeId: promo.id }] });
        const again = await postJson(`${app.url}/payments/initiate`, { slot_id: 'stm_1', addressId: other.address.id, promoCode: promo.code }, other.token);
        expect(again.body.error).toBe('You have already used this promo code');
    });

    it('the lab cart neither lists nor validates consultation-only codes', async () => {
        const { token, promo } = await cartWith('CONSULT');
        const both = await makePromo();
        await testDb.promoCode.update({ where: { id: both.id }, data: { appliesTo: 'BOTH' } });
        const list = await fetch(`${promoApp.url}/promos/available`, { headers: { authorization: `Bearer ${token}` } });
        const codes = (await list.json()).map((p: { code: string }) => p.code);
        expect(codes).toContain(both.code);
        expect(codes).not.toContain(promo.code);
        const check = await postJson(`${promoApp.url}/promos/validate`, { code: promo.code, cartAmount: 1000 }, token);
        expect(check.status).toBe(400);
        expect(check.body.error).toBe('This promo code is for doctor consultations only');
    });
});
