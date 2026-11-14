import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { describeDb, makeCatalogItem, makeUser, resetCommerceData, testDb } from '../test/db';
import { postJson, serve, tokenFor, useTestJwtSecret } from '../test/http';

useTestJwtSecret();

// Redis is not available in tests; a fake store gives claimOnce the same nx/del behaviour.
const m = vi.hoisted(() => ({ keys: new Set<string>(), down: false }));
vi.mock('../utils/rateLimit', () => ({
    redis: {
        set: async (k: string) => { if (m.down) throw new TypeError('fetch failed'); return m.keys.has(k) ? null : (m.keys.add(k), 'OK'); },
        del: async (k: string) => Number(m.keys.delete(k)),
    },
    underLimit: async () => true,
}));

const { default: cartRouter } = await import('./cart');

let app: Awaited<ReturnType<typeof serve>>;

describeDb('the Idempotency-Key on adding to the cart (real Postgres)', () => {
    beforeEach(async () => {
        await resetCommerceData();
        m.keys.clear();
        m.down = false;
        app = app || (await serve('/cart', cartRouter));
    });

    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });

    async function shopper() {
        const user = await makeUser();
        await makeCatalogItem('DEAL1', 499);
        return { user, token: tokenFor(user as any) };
    }

    const add = (token: string, key?: string) =>
        postJson(`${app.url}/cart/items`, { testCode: 'DEAL1' }, token, key ? { 'Idempotency-Key': key } : {});

    const lines = (userId: string) => testDb.cartItem.count({ where: { cart: { userId } } });

    it('adds one line for a repeated tap carrying the same key', async () => {
        const { user, token } = await shopper();
        const first = await add(token, 'tap-key-12345678');
        const second = await add(token, 'tap-key-12345678');

        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(second.body).toMatchObject({ duplicate: true });
        expect(await lines(user.id)).toBe(1);
    });

    it('adds a second line for a deliberate second add with a new key', async () => {
        const { user, token } = await shopper();
        await add(token, 'tap-key-12345678');
        await add(token, 'tap-key-87654321');
        expect(await lines(user.id)).toBe(2);
    });

    it('keeps one customer key from blocking another', async () => {
        const a = await shopper();
        const b = await shopper();
        await add(a.token, 'shared-key-123456');
        const other = await add(b.token, 'shared-key-123456');

        expect(other.status).toBe(201);
        expect(await lines(b.user.id)).toBe(1);
    });

    it('adds every time when the client sends no key', async () => {
        const { user, token } = await shopper();
        await add(token);
        await add(token);
        expect(await lines(user.id)).toBe(2);
    });

    it('still adds the item when Redis is unreachable', async () => {
        const { user, token } = await shopper();
        m.down = true;
        expect((await add(token, 'tap-key-12345678')).status).toBe(201);
        expect(await lines(user.id)).toBe(1);
    });

    it('refuses an item that is not in the catalog or is switched off', async () => {
        const { user, token } = await shopper();
        expect((await postJson(`${app.url}/cart/items`, { testCode: 'NOPE' }, token)).status).toBe(404);
        await makeCatalogItem('DEAL1', 499, false);
        expect((await add(token, 'tap-key-12345678')).status).toBe(400);
        expect(await lines(user.id)).toBe(0);
    });
});
