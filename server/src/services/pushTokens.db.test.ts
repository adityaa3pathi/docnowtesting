/** HTTP + Postgres checks for /api/profile/push-token. Runs only when TEST_DATABASE_URL is set. */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { serve, tokenFor, useTestJwtSecret } from '../modules/consultations/test/http';
import { describeDb, makeUser, testDb } from '../modules/consultations/test/db';

useTestJwtSecret();

const TOKEN = 'ExponentPushToken[dbTest123]';

describeDb('/api/profile/push-token', () => {
    let app: Awaited<ReturnType<typeof serve>>;

    beforeAll(async () => {
        const { default: profileRoutes } = await import('../routes/profile');
        app = await serve('/api/profile', profileRoutes);
    });
    afterAll(() => app.close());
    beforeEach(() => testDb.pushToken.deleteMany({ where: { token: { startsWith: 'ExponentPushToken[dbTest' } } }));

    const call = (method: 'POST' | 'DELETE', user: { id: string; tokenVersion: number } | null, body: unknown) =>
        fetch(`${app.url}/api/profile/push-token`, {
            method,
            headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {}) },
            body: JSON.stringify(body),
        });

    it('requires sign-in and a valid token', async () => {
        expect((await call('POST', null, { token: TOKEN, platform: 'android' })).status).toBe(401);
        const user = await makeUser();
        expect((await call('POST', user, { token: 'nope', platform: 'android' })).status).toBe(400);
    });

    it('stores the token once, and moves it when another account signs in on the phone', async () => {
        const a = await makeUser();
        const b = await makeUser();
        expect((await call('POST', a, { token: TOKEN, platform: 'android' })).status).toBe(204);
        expect((await call('POST', a, { token: TOKEN, platform: 'android' })).status).toBe(204);
        expect(await testDb.pushToken.count({ where: { token: TOKEN } })).toBe(1);

        await call('POST', b, { token: TOKEN, platform: 'android' });
        expect((await testDb.pushToken.findUniqueOrThrow({ where: { token: TOKEN } })).userId).toBe(b.id);
    });

    it('lets only the owner remove a token', async () => {
        const a = await makeUser();
        const b = await makeUser();
        await call('POST', a, { token: TOKEN, platform: 'ios' });
        expect((await call('DELETE', b, { token: TOKEN })).status).toBe(204);
        expect(await testDb.pushToken.count({ where: { token: TOKEN } })).toBe(1);
        expect((await call('DELETE', a, { token: TOKEN })).status).toBe(204);
        expect(await testDb.pushToken.count({ where: { token: TOKEN } })).toBe(0);
    });
});
