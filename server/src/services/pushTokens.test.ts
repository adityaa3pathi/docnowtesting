import { describe, expect, it, vi } from 'vitest';
import { MAX_TOKENS_PER_USER, pushTokenSchema, removePushToken, removePushTokenSchema, savePushToken } from './pushTokens';

const TOKEN = 'ExponentPushToken[xAbC123_-zz9]';

function fakeDb(stale: { id: string }[] = []) {
    return {
        pushToken: {
            upsert: vi.fn().mockResolvedValue({}),
            findMany: vi.fn().mockResolvedValue(stale),
            deleteMany: vi.fn().mockResolvedValue({ count: stale.length || 1 }),
        },
    };
}

describe('push token validation', () => {
    it('accepts Expo tokens from iOS and Android', () => {
        expect(pushTokenSchema.safeParse({ token: TOKEN, platform: 'android' }).success).toBe(true);
        expect(pushTokenSchema.safeParse({ token: ' ExpoPushToken[abc] ', platform: 'ios' }).success).toBe(true);
    });

    it('refuses other strings and platforms', () => {
        expect(pushTokenSchema.safeParse({ token: 'fcm:abc', platform: 'android' }).error?.issues[0]?.message).toBe('Not an Expo push token');
        expect(pushTokenSchema.safeParse({ token: 'ExponentPushToken[]', platform: 'android' }).success).toBe(false);
        expect(pushTokenSchema.safeParse({ token: 'ExponentPushToken[a b]', platform: 'android' }).success).toBe(false);
        expect(pushTokenSchema.safeParse({ token: TOKEN, platform: 'web' }).error?.issues[0]?.message).toBe('Platform must be ios or android');
        expect(removePushTokenSchema.safeParse({ token: '' }).success).toBe(false);
    });
});

describe('savePushToken', () => {
    it('upserts by token so a phone moves to the account that signed in last', async () => {
        const db = fakeDb();
        await savePushToken('user-2', { token: TOKEN, platform: 'ios' }, db as never);
        expect(db.pushToken.upsert).toHaveBeenCalledWith({
            where: { token: TOKEN },
            update: { userId: 'user-2', platform: 'ios' },
            create: { userId: 'user-2', token: TOKEN, platform: 'ios' },
        });
    });

    it('keeps only the newest phones per account', async () => {
        const db = fakeDb([{ id: 'old-1' }, { id: 'old-2' }]);
        await savePushToken('user-1', { token: TOKEN, platform: 'android' }, db as never);
        expect(db.pushToken.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { userId: 'user-1' }, orderBy: { updatedAt: 'desc' }, skip: MAX_TOKENS_PER_USER }),
        );
        expect(db.pushToken.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old-1', 'old-2'] } } });
    });

    it('does not delete anything while under the limit', async () => {
        const db = fakeDb([]);
        await savePushToken('user-1', { token: TOKEN, platform: 'android' }, db as never);
        expect(db.pushToken.deleteMany).not.toHaveBeenCalled();
    });
});

describe('removePushToken', () => {
    it('only removes the token for the signed-in account', async () => {
        const db = fakeDb();
        await removePushToken('user-1', TOKEN, db as never);
        expect(db.pushToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', token: TOKEN } });
    });
});
