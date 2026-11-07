import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET ??= 'test-secret-for-session-rotation-tests';

const db = vi.hoisted(() => ({
    sessions: [] as any[],
}));

vi.mock('../db', () => {
    const session = {
        findFirst: vi.fn(async ({ where }: any) => {
            const s = db.sessions.find((x) => x.refreshTokenHash === where.refreshTokenHash);
            return s ? { ...s, user: { mobile: '9999999999', tokenVersion: 0, status: 'ACTIVE' } } : null;
        }),
        create: vi.fn(async ({ data }: any) => {
            const s = { id: `s${db.sessions.length + 1}`, revokedAt: null, replacedById: null, ...data };
            db.sessions.push(s);
            return s;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
            const hits = db.sessions.filter((x) =>
                (where.id === undefined || x.id === where.id) &&
                (where.familyId === undefined || x.familyId === where.familyId) &&
                (!('revokedAt' in where) || x.revokedAt === where.revokedAt));
            hits.forEach((x) => Object.assign(x, data));
            return { count: hits.length };
        }),
    };
    return {
        prisma: {
            session,
            // Sequential fake: enough to prove the conditional update, not real isolation.
            $transaction: async (fn: any) => {
                const snapshot = db.sessions.map((x) => ({ ...x }));
                try { return await fn({ session }); } catch (e) { db.sessions = snapshot; throw e; }
            },
        },
    };
});

const { rotateRefreshToken, RefreshRaceError } = await import('./sessionService');
const crypto = await import('crypto');
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

function seed(token: string, extra: Record<string, unknown> = {}) {
    db.sessions = [{
        id: 's0', userId: 'u1', familyId: 'f1', refreshTokenHash: hash(token), clientType: 'web',
        expiresAt: new Date(Date.now() + 86_400_000), revokedAt: null, replacedById: null, ...extra,
    }];
}

beforeEach(() => { db.sessions = []; });

describe('rotateRefreshToken', () => {
    it('rotates once and links the chain', async () => {
        seed('old');
        const out = await rotateRefreshToken('old');
        expect(out.refreshToken).toBeTruthy();
        expect(db.sessions[0].revokedAt).toBeInstanceOf(Date);
        expect(db.sessions[0].replacedById).toBe(out.sessionId);
    });

    it('a second refresh moments later is a race, not reuse: no family revoke, no new token', async () => {
        seed('old');
        await rotateRefreshToken('old');
        const live = db.sessions.length;
        await expect(rotateRefreshToken('old')).rejects.toBeInstanceOf(RefreshRaceError);
        expect(db.sessions.length).toBe(live);
        expect(db.sessions.find((s) => s.id !== 's0')!.revokedAt).toBeNull();
    });

    it('reusing a token rotated long ago revokes the whole family', async () => {
        seed('old', { revokedAt: new Date(Date.now() - 120_000), replacedById: 's9' });
        db.sessions.push({ id: 's9', userId: 'u1', familyId: 'f1', refreshTokenHash: hash('new'), revokedAt: null });
        await expect(rotateRefreshToken('old')).rejects.toThrow('Session revoked');
        expect(db.sessions.find((s) => s.id === 's9')!.revokedAt).toBeInstanceOf(Date);
    });

    it('loses the race cleanly when another caller revoked the row first', async () => {
        seed('old');
        const { prisma } = await import('../db') as any;
        prisma.session.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
        await expect(rotateRefreshToken('old')).rejects.toBeInstanceOf(RefreshRaceError);
        expect(db.sessions.length).toBe(1); // the new session rolled back
    });
});
