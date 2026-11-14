import { describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET ??= 'test-secret-for-auth-session-tests';
vi.mock('../db', () => ({ prisma: {} }));
const { isSessionUsable } = await import('./auth');

describe('isSessionUsable', () => {
    it('blocks logged-out or family-revoked sessions but not rotated ones', () => {
        expect(isSessionUsable({ revokedAt: null, replacedById: null })).toBe(true);
        expect(isSessionUsable({ revokedAt: new Date(), replacedById: 's2' })).toBe(true);
        expect(isSessionUsable({ revokedAt: new Date(), replacedById: null })).toBe(false);
        expect(isSessionUsable(null)).toBe(false);
        expect(isSessionUsable(undefined)).toBe(true);
    });
});
