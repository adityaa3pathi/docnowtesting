import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessToken } from 'livekit-server-sdk';
import { serve } from './test/http';

vi.mock('../../utils/logger', () => ({
    logBusinessEvent: vi.fn(),
    logAlert: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const API_KEY = 'APItest';
const API_SECRET = 'secret-secret-secret-secret-secret';
const ROOM = 'consult-11111111-2222-3333-4444-555555555555';

/** A join token like the server hands out, with an adjustable lifetime. */
function joinToken(identity: string, ttlSeconds: number, secret = API_SECRET) {
    const token = new AccessToken(API_KEY, secret, { identity, ttl: ttlSeconds });
    token.addGrant({ room: ROOM, roomJoin: true, canPublish: true, canSubscribe: true });
    return token.toJwt();
}

describe('consult call events', () => {
    let app: { url: string; close: () => Promise<void> };
    let logBusinessEvent: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        process.env.LIVEKIT_URL = 'wss://docnow-test.livekit.cloud';
        process.env.LIVEKIT_API_KEY = API_KEY;
        process.env.LIVEKIT_API_SECRET = API_SECRET;
        logBusinessEvent = (await import('../../utils/logger')).logBusinessEvent as any;
        const routes = await import('./consultations.callEvents');
        app = await serve('/consult', routes.consultCallEventRoutes);
    });
    afterAll(async () => {
        await app?.close();
        process.env.LIVEKIT_API_KEY = '';
        process.env.LIVEKIT_API_SECRET = '';
    });

    const report = (body: unknown) =>
        fetch(`${app.url}/consult/call-events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

    it('records a failure reported with a valid join token', async () => {
        const res = await report({ token: await joinToken('patient:p-1', 7200), event: 'media_failed', reason: 'NotAllowedError' });
        expect(res.status).toBe(204);
        expect(logBusinessEvent).toHaveBeenCalledWith(
            'consult_call_event',
            { callEvent: 'media_failed', identity: 'patient:p-1', room: ROOM, reason: 'NotAllowedError' },
            'warn',
        );
    });

    it('logs a reconnect at info and needs no reason', async () => {
        const res = await report({ token: await joinToken('caretaker:u-1', 7200), event: 'reconnected' });
        expect(res.status).toBe(204);
        expect(logBusinessEvent).toHaveBeenCalledWith('consult_call_event', expect.objectContaining({ callEvent: 'reconnected', identity: 'caretaker:u-1' }), 'info');
    });

    it('still accepts a drop reported just after the token expired', async () => {
        const res = await report({ token: await joinToken('doctor:d-1', -120), event: 'disconnected' });
        expect(res.status).toBe(204);
    });

    it('rejects a token expired beyond the grace window', async () => {
        const res = await report({ token: await joinToken('doctor:d-1', -3600), event: 'disconnected' });
        expect(res.status).toBe(401);
        expect(logBusinessEvent).not.toHaveBeenCalled();
    });

    it('rejects a forged token without saying why', async () => {
        const res = await report({ token: await joinToken('doctor:d-1', 7200, 'attacker-secret-attacker-secret!!'), event: 'connect_failed' });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Not allowed' });
        expect(logBusinessEvent).not.toHaveBeenCalled();
    });

    it('rejects an unknown event, a long reason and extra fields', async () => {
        const token = await joinToken('patient:p-1', 7200);
        expect((await report({ token, event: 'exploded' })).status).toBe(400);
        expect((await report({ token, event: 'disconnected', reason: 'x'.repeat(201) })).status).toBe(400);
        expect((await report({ token, event: 'disconnected', identity: 'doctor:someone-else' })).status).toBe(400);
        expect((await report({ event: 'disconnected' })).status).toBe(400);
        expect(logBusinessEvent).not.toHaveBeenCalled();
    });

    it('reports video as not set up when LiveKit has no keys', async () => {
        const token = await joinToken('patient:p-1', 7200);
        process.env.LIVEKIT_API_SECRET = '';
        try {
            expect((await report({ token, event: 'connect_failed' })).status).toBe(503);
        } finally {
            process.env.LIVEKIT_API_SECRET = API_SECRET;
        }
    });
});
