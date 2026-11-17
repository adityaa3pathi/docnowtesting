import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from './consultations.policy';
import { describeDb, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('consultation rules (real Postgres)', () => {
    let service: typeof import('./consultations.policy.service');
    let server: { url: string; close: () => Promise<void> };
    let admin: { id: string; tokenVersion: number; name: string | null };

    beforeAll(async () => {
        service = await import('./consultations.policy.service');
        const { policyRoutes } = await import('./consultations.policy.routes');
        server = await serve('/policy', policyRoutes);
    });
    afterAll(async () => {
        await server?.close();
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        await testDb.adminAuditLog.deleteMany({ where: { entity: 'ConsultPolicy' } });
        admin = await makeUser('SUPER_ADMIN');
    });

    const edit = (rules = DEFAULT_RULES, reason = 'test change') => ({
        rules,
        reason,
        adminId: admin.id,
        adminName: 'Admin',
        ip: '127.0.0.1',
    });
    const put = (token: string | null, body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${server.url}/policy`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
            body: JSON.stringify(body),
        });

    it('creates the next version and keeps exactly one active row', async () => {
        const created = await service.updatePolicy(edit({ ...DEFAULT_RULES, holdMinutes: 12 }));
        expect(created.version).toBe(2);
        const active = await testDb.consultPolicy.findMany({ where: { isActive: true } });
        expect(active.map((r) => r.version)).toEqual([2]);
        expect((await service.getActivePolicy()).rules.holdMinutes).toBe(12);
    });

    it('rejects invalid rules and changes nothing', async () => {
        await expect(service.updatePolicy(edit({ ...DEFAULT_RULES, holdMinutes: 3 * 24 * 60 }))).rejects.toMatchObject({ status: 400 });
        expect((await testDb.consultPolicy.findMany()).length).toBe(1);
        expect((await service.getActivePolicy()).version).toBe(1);
    });

    it('leaves one active row after two edits at the same time', async () => {
        await Promise.all([
            service.updatePolicy(edit({ ...DEFAULT_RULES, holdMinutes: 11 })),
            service.updatePolicy(edit({ ...DEFAULT_RULES, holdMinutes: 13 })),
        ]);
        expect(await testDb.consultPolicy.count({ where: { isActive: true } })).toBe(1);
        expect((await testDb.consultPolicy.findMany({ orderBy: { version: 'asc' } })).map((r) => r.version)).toEqual([1, 2, 3]);
    });

    it('writes an audit entry with actor, ip, reason, old and new values', async () => {
        await service.updatePolicy(edit({ ...DEFAULT_RULES, uploadLimitMb: 20 }, 'raise upload'));
        const log = await testDb.adminAuditLog.findFirstOrThrow({ where: { entity: 'ConsultPolicy' } });
        expect(log.adminId).toBe(admin.id);
        expect(log.ipAddress).toBe('127.0.0.1');
        expect((log.oldValue as any).uploadLimitMb).toBe(10);
        expect((log.newValue as any).reason).toBe('raise upload');
        expect((log.newValue as any).rules.uploadLimitMb).toBe(20);
    });

    it('does not change a consultation snapshot when rules are edited', async () => {
        const before = (await service.getActivePolicy()).rules;
        await service.updatePolicy(edit({ ...DEFAULT_RULES, platformFeeBps: 2000 }));
        expect(before.platformFeeBps).toBe(1000);
        expect((await service.getActivePolicy()).rules.platformFeeBps).toBe(2000);
    });

    describe('PUT route', () => {
        const body = { rules: DEFAULT_RULES, reason: 'route change' };

        it('accepts a super admin and rejects a missing reason', async () => {
            expect((await put(tokenFor(admin), body)).status).toBe(200);
            expect((await put(tokenFor(admin), { ...body, reason: '' })).status).toBe(400);
        });
        it('gives a non-admin 403 and no token 401', async () => {
            const user = await makeUser('USER');
            expect((await put(tokenFor(user), body)).status).toBe(403);
            expect((await put(null, body)).status).toBe(401);
        });
        it('gives a doctor 403', async () => {
            const doctor = await makeUser('DOCTOR');
            expect((await put(tokenFor(doctor), body)).status).toBe(403);
        });
        it('rate limits the eleventh edit in an hour', async () => {
            const statuses: number[] = [];
            for (let i = 0; i < 11; i++) statuses.push((await put(tokenFor(admin), body)).status);
            expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
            expect(statuses[10]).toBe(429);
        });
        it('rejects a cookie request with the mobile header and no CSRF token', async () => {
            const res = await put(tokenFor(admin), body, { cookie: `docnow_access=${tokenFor(admin)}`, 'x-client-type': 'mobile' });
            expect(res.status).toBe(403);
            expect(await testDb.consultPolicy.count()).toBe(1);
        });
    });
});
