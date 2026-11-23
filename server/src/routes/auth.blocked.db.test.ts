import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { describeDb, makeUser, resetCommerceData, testDb } from '../test/db';
import { postJson, serve, useTestJwtSecret } from '../test/http';

useTestJwtSecret();

// Each route has its own per-IP limit; these tests call them more often than a person would.
vi.mock('../middleware/rateLimiter', () => ({ rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
const sendOtpViaWhatsApp = vi.fn(async () => ({ id: 'msg-1', status: 'accepted' }));
vi.mock('../services/wappieWhatsApp', () => ({ sendOtpViaWhatsApp: (...args: unknown[]) => (sendOtpViaWhatsApp as any)(...args) }));

const { default: authRouter } = await import('./auth');
const { createSession, AccountBlockedError, ACCOUNT_BLOCKED_MESSAGE } = await import('../services/sessionService');

let app: Awaited<ReturnType<typeof serve>>;
const call = (path: string, body: unknown) => postJson(`${app.url}/auth${path}`, body, undefined, { 'x-client-type': 'mobile' });

const PASSWORD = 'secret123';
async function makeAccount(status: 'ACTIVE' | 'BLOCKED') {
    const user = await makeUser();
    return testDb.user.update({ where: { id: user.id }, data: { status, password: await bcrypt.hash(PASSWORD, 4) } });
}
/** An OTP issued before an admin blocked the account; it is still unexpired. */
const issueOtp = (mobile: string, code = '123456') =>
    testDb.oTP.upsert({ where: { identifier: mobile }, update: { code, expiresAt: new Date(Date.now() + 5 * 60_000) }, create: { identifier: mobile, code, expiresAt: new Date(Date.now() + 5 * 60_000) } });
const sessionsOf = (userId: string) => testDb.session.count({ where: { userId } });

const expectBlocked = (res: { status: number; body: any }) => {
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: ACCOUNT_BLOCKED_MESSAGE, code: 'ACCOUNT_BLOCKED' });
};

describeDb('a blocked (blacklisted) account cannot sign in', () => {
    beforeEach(async () => {
        await resetCommerceData();
        await testDb.oTP.deleteMany();
        sendOtpViaWhatsApp.mockClear();
        app = app || (await serve('/auth', authRouter));
    });
    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });

    it('login OTP: refused before any WhatsApp message is sent', async () => {
        const blocked = await makeAccount('BLOCKED');
        expectBlocked(await call('/login/send-otp', { mobile: blocked.mobile }));
        expect(sendOtpViaWhatsApp).not.toHaveBeenCalled();
        expect(await testDb.oTP.findUnique({ where: { identifier: blocked.mobile } })).toBeNull();

        const active = await makeAccount('ACTIVE');
        expect((await call('/login/send-otp', { mobile: active.mobile })).status).toBe(200);
        expect(sendOtpViaWhatsApp).toHaveBeenCalledTimes(1);
    });

    it('password: the right password gets the blocked message and no session; a wrong one stays "Invalid credentials"', async () => {
        const blocked = await makeAccount('BLOCKED');
        expectBlocked(await call('/login/password', { mobile: blocked.mobile, password: PASSWORD }));
        const wrong = await call('/login/password', { mobile: blocked.mobile, password: 'wrong123' });
        expect(wrong.status).toBe(401);
        expect(wrong.body.error).toBe('Invalid credentials');
        expect(await sessionsOf(blocked.id)).toBe(0);

        const active = await makeAccount('ACTIVE');
        const ok = await call('/login/password', { mobile: active.mobile, password: PASSWORD });
        expect(ok.status).toBe(200);
        expect(await sessionsOf(active.id)).toBe(1);
    });

    it('verify OTP: a code sent before the block does not create a session', async () => {
        const blocked = await makeAccount('BLOCKED');
        await issueOtp(blocked.mobile);
        expectBlocked(await call('/login/verify-otp', { mobile: blocked.mobile, code: '123456' }));
        expect(await sessionsOf(blocked.id)).toBe(0);
        expect((await testDb.user.findUniqueOrThrow({ where: { id: blocked.id } })).isVerified).toBe(false);
    });

    it('forgot password: no reset code is sent, and an earlier code cannot change the password', async () => {
        const blocked = await makeAccount('BLOCKED');
        expectBlocked(await call('/forgot-password/send-otp', { mobile: blocked.mobile }));
        expect(sendOtpViaWhatsApp).not.toHaveBeenCalled();

        await issueOtp(blocked.mobile);
        const before = (await testDb.user.findUniqueOrThrow({ where: { id: blocked.id } })).password;
        expectBlocked(await call('/forgot-password/verify-reset', { mobile: blocked.mobile, code: '123456', newPassword: 'newpass1' }));
        expect((await testDb.user.findUniqueOrThrow({ where: { id: blocked.id } })).password).toBe(before);
    });

    it('unblocking restores sign-in', async () => {
        const user = await makeAccount('BLOCKED');
        expectBlocked(await call('/login/password', { mobile: user.mobile, password: PASSWORD }));
        await testDb.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
        expect((await call('/login/password', { mobile: user.mobile, password: PASSWORD })).status).toBe(200);
    });

    it('a deleted account keeps today\'s behaviour: its old number reads as "no account" and can sign up again', async () => {
        // What account deletion leaves behind: the mobile replaced by a placeholder, and the status BLOCKED.
        const user = await makeAccount('ACTIVE');
        const formerMobile = user.mobile;
        await testDb.user.update({ where: { id: user.id }, data: { mobile: `deleted:${user.id}`, status: 'BLOCKED', password: null } });

        const login = await call('/login/send-otp', { mobile: formerMobile });
        expect(login.status).toBe(404);
        expect(login.body.error).toBe('User does not exist. Please Signup.');
        expect((await call('/signup/send-otp', { mobile: formerMobile })).status).toBe(200);
    });

    it('createSession itself refuses a blocked account (backstop for any other sign-in path)', async () => {
        const blocked = await makeAccount('BLOCKED');
        await expect(createSession(blocked.id, blocked.mobile)).rejects.toBeInstanceOf(AccountBlockedError);
        expect(await sessionsOf(blocked.id)).toBe(0);
    });
});
