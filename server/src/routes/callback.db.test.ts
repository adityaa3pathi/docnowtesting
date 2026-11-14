import { afterAll, beforeEach, expect, it } from 'vitest';
import { describeDb, testDb } from '../test/db';
import { postJson, serve } from '../test/http';

const { default: callbackRouter } = await import('./callback');
let app: Awaited<ReturnType<typeof serve>>;

describeDb('the public callback form (real Postgres)', () => {
    beforeEach(async () => {
        await testDb.callbackRequest.deleteMany();
        app = app || (await serve('/callback', callbackRouter));
    });
    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });

    it('saves a valid request and returns no personal details back', async () => {
        const res = await postJson(`${app.url}/callback/request`, { name: ' Asha ', mobile: '9876543210', city: 'Jaipur' });
        expect(res.status).toBe(201);
        expect(res.body.data).not.toHaveProperty('mobile');
        expect(await testDb.callbackRequest.findFirstOrThrow()).toMatchObject({ name: 'Asha', mobile: '9876543210', city: 'Jaipur' });
    });

    it('refuses bad numbers and missing names, and saves nothing', async () => {
        for (const body of [{ name: 'Asha', mobile: '12345' }, { name: 'Asha', mobile: '5876543210' }, { mobile: '9876543210' }, { name: 'A', mobile: '9876543210' }]) {
            expect((await postJson(`${app.url}/callback/request`, body)).status).toBe(400);
        }
        expect(await testDb.callbackRequest.count()).toBe(0);
    });
});
