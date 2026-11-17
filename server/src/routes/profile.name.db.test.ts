import { afterAll, beforeEach, expect, it } from 'vitest';
import { describeDb, makeUser, resetCommerceData, testDb } from '../test/db';
import { serve, tokenFor, useTestJwtSecret } from '../test/http';

useTestJwtSecret();
const { default: profileRouter } = await import('./profile');

let app: Awaited<ReturnType<typeof serve>>;
const put = (token: string, body: unknown) => fetch(`${app.url}/profile`, {
    method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-client-type': 'mobile' }, body: JSON.stringify(body),
});

describeDb('setting a name from the profile (app users who signed in by OTP)', () => {
    beforeEach(async () => {
        await resetCommerceData();
        app = app || (await serve('/profile', profileRouter));
    });
    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });

    it('saves a trimmed name so checkout no longer reports a missing name', async () => {
        const user = await makeUser({ name: '' });
        const res = await put(tokenFor(user as any), { name: '  Asha Devi ' });
        expect(res.status).toBe(200);
        expect((await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('Asha Devi');
    });

    it('refuses names with numbers or of the wrong length, and changes nothing', async () => {
        const user = await makeUser({ name: 'Old Name' });
        for (const name of ['A', 'Asha 2', 'x'.repeat(61), 42]) {
            expect((await put(tokenFor(user as any), { name })).status).toBe(400);
        }
        expect((await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('Old Name');
    });
});
