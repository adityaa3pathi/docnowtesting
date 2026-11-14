import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { describeDb, makeAddress, makeCartWithItem, makePromo, makeUser, makeWallet, resetCommerceData, testDb } from '../../test/db';
import { postJson, serve, tokenFor, useTestJwtSecret } from '../../test/http';

useTestJwtSecret();

const m = vi.hoisted(() => ({ orderCreate: vi.fn(), finalize: vi.fn(), bonus: vi.fn() }));

// Razorpay and the partner call are the only outbound hops this route makes; both are stubbed.
vi.mock('../../services/razorpay', () => ({ getRazorpay: () => ({ orders: { create: m.orderCreate }, payments: { refund: vi.fn() } }) }));
vi.mock('../../services/bookingFinalization', () => ({ finalizeBooking: m.finalize, syncManagerOrder: vi.fn() }));
vi.mock('../../utils/referralService', () => ({ tryAwardFirstOrderBonus: m.bonus }));
// The route allows one initiate per 10s per user; these tests check the booking, not the throttle.
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

const { default: paymentsRouter } = await import('../../routes/payments');

let app: Awaited<ReturnType<typeof serve>>;

describeDb('pay on collection at checkout (real Postgres)', () => {
    beforeEach(async () => {
        await resetCommerceData();
        m.orderCreate.mockReset().mockResolvedValue({ id: 'order_test_1' });
        m.finalize.mockReset().mockResolvedValue({ status: 'success' });
        m.bonus.mockReset().mockResolvedValue(undefined);
        process.env.PAY_ON_COLLECTION_ENABLED = 'true';
        app = app || (await serve('/payments', paymentsRouter));
    });

    afterAll(async () => {
        delete process.env.PAY_ON_COLLECTION_ENABLED;
        await app?.close();
        await testDb?.$disconnect();
    });

    async function checkout(overrides: { price?: number; wallet?: number; promo?: { discountValue: number; discountType?: 'FLAT' | 'PERCENTAGE' } } = {}) {
        const user = await makeUser();
        const address = await makeAddress(user.id);
        const { price } = await makeCartWithItem(user.id, { price: overrides.price ?? 1000 });
        if (overrides.wallet !== undefined) await makeWallet(user.id, overrides.wallet);
        const promo = overrides.promo ? await makePromo(overrides.promo) : null;
        return { user, address, price, promo, token: tokenFor(user as any) };
    }

    const initiate = (url: string, token: string, body: Record<string, unknown>) =>
        postJson(`${url}/payments/initiate`, { slot_id: 'stm_1', addressId: body.addressId, ...body }, token);

    it('refuses pay on collection while the switch is off', async () => {
        const { address, token } = await checkout();
        process.env.PAY_ON_COLLECTION_ENABLED = 'false';
        const res = await initiate(app.url, token, { addressId: address.id, paymentMethod: 'PAY_ON_COLLECTION' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('PAY_ON_COLLECTION_OFF');
        expect(await testDb.booking.count()).toBe(0);
        expect(m.orderCreate).not.toHaveBeenCalled();
    });

    it('reports the switch through GET /payments/options', async () => {
        const on = await fetch(`${app.url}/payments/options`);
        expect(await on.json()).toEqual({ payOnCollection: true });
        process.env.PAY_ON_COLLECTION_ENABLED = '';
        expect(await (await fetch(`${app.url}/payments/options`)).json()).toEqual({ payOnCollection: false });
    });

    it('rejects a payment method that is neither online nor pay on collection', async () => {
        const { address, token } = await checkout();
        const res = await initiate(app.url, token, { addressId: address.id, paymentMethod: 'CHEQUE' });
        expect(res.status).toBe(400);
        expect(await testDb.booking.count()).toBe(0);
    });

    it('books, finalizes and clears the cart without any Razorpay order', async () => {
        const { user, address, token } = await checkout({ price: 1000 });
        const res = await initiate(app.url, token, { addressId: address.id, paymentMethod: 'PAY_ON_COLLECTION' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ paymentMethod: 'PAY_ON_COLLECTION', status: 'confirmed' });
        const booking = await testDb.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
        expect(booking.paymentMethod).toBe('PAY_ON_COLLECTION');
        expect(booking.paymentStatus).toBe('PAID');
        expect(booking.razorpayPaymentId).toBe(`COD_${booking.id}`);
        expect(booking.razorpayOrderId).toBeNull();
        expect(booking.collectedAt).toBeNull();
        expect(m.finalize).toHaveBeenCalledWith(booking.id);
        expect(m.orderCreate).not.toHaveBeenCalled();
        expect(await testDb.cartItem.count({ where: { cart: { userId: user.id } } })).toBe(0);
    });

    it('does not award the referral bonus until the collector reports the money', async () => {
        const { address, token } = await checkout();
        await initiate(app.url, token, { addressId: address.id, paymentMethod: 'PAY_ON_COLLECTION' });
        expect(m.bonus).not.toHaveBeenCalled();
    });

    it('takes promo and wallet off the amount and gives the paisa back as discount', async () => {
        // 1000 + 100 fee - 30% - 50 wallet leaves 720.something; only whole rupees go to the collector.
        const { address, token } = await checkout({ price: 999, wallet: 50, promo: { discountType: 'PERCENTAGE', discountValue: 10 } });
        const promo = await testDb.promoCode.findFirstOrThrow();
        const res = await initiate(app.url, token, { addressId: address.id, paymentMethod: 'PAY_ON_COLLECTION', promoCode: promo.code, useWallet: true });

        const booking = await testDb.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
        expect(booking.walletAmount).toBe(50);
        expect(Number.isInteger(booking.finalAmount)).toBe(true);
        // Nothing is lost or gained: total = discount + wallet + what the collector takes.
        expect(booking.totalAmount).toBeCloseTo(booking.discountAmount + booking.walletAmount + booking.finalAmount, 5);
        expect(booking.finalAmount).toBe(Math.floor(booking.totalAmount - booking.walletAmount - (booking.totalAmount * 0.1)));
        expect(await testDb.promoRedemption.count({ where: { bookingId: booking.id } })).toBe(1);
        expect((await testDb.wallet.findFirstOrThrow()).balance).toBe(0);
    });

    it('stays an online zero-amount order when the wallet covers everything', async () => {
        const { user, address, token } = await checkout({ price: 100, wallet: 10000 });
        const res = await initiate(app.url, token, { addressId: address.id, paymentMethod: 'PAY_ON_COLLECTION', useWallet: true });

        expect(res.body).toMatchObject({ status: 'confirmed', amount: 0 });
        expect(res.body.paymentMethod).toBeUndefined();
        const booking = await testDb.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
        expect(booking.paymentMethod).toBe('ONLINE');
        expect(booking.finalAmount).toBe(0);
        expect(booking.razorpayPaymentId).toBe(`ZERO_${booking.id}`);
        expect(m.orderCreate).not.toHaveBeenCalled();
        expect(m.bonus).toHaveBeenCalledWith(user.id, booking.id);
    });

    it('returns the same booking on a retried key, still without Razorpay', async () => {
        const { address, token } = await checkout();
        const body = { addressId: address.id, paymentMethod: 'PAY_ON_COLLECTION', idempotencyKey: 'cod-retry-key-1' };
        const first = await initiate(app.url, token, body);
        const second = await initiate(app.url, token, body);

        expect(second.status).toBe(200);
        expect(second.body.bookingId).toBe(first.body.bookingId);
        expect(second.body).toMatchObject({ paymentMethod: 'PAY_ON_COLLECTION', idempotent: true });
        expect(second.body.razorpayOrderId).toBeUndefined();
        expect(await testDb.booking.count()).toBe(1);
        expect(m.orderCreate).not.toHaveBeenCalled();
    });

    it('still creates a Razorpay order for an online checkout', async () => {
        const { address, token } = await checkout({ price: 1000 });
        const res = await initiate(app.url, token, { addressId: address.id, paymentMethod: 'ONLINE' });

        expect(res.body.razorpayOrderId).toBe('order_test_1');
        const booking = await testDb.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
        expect(booking.paymentMethod).toBe('ONLINE');
        expect(booking.paymentStatus).toBe('INITIATED');
        expect(m.orderCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: booking.finalAmount * 100 }));
        expect(m.finalize).not.toHaveBeenCalled();
    });
});
