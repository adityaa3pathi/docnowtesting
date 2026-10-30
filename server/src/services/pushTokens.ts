/**
 * Expo push tokens for the mobile app. The app sends its token after the person allows
 * notifications, and again only when the token or the signed-in account changes.
 */
import { z } from 'zod';
import { prisma } from '../db';

/** Older phones that were reset or replaced stop being notified after this many newer ones. */
export const MAX_TOKENS_PER_USER = 10;

export const pushTokenSchema = z.object({
    token: z.string().trim().regex(/^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/, 'Not an Expo push token'),
    platform: z.enum(['ios', 'android'], { message: 'Platform must be ios or android' }),
});

export const removePushTokenSchema = z.object({
    token: z.string().trim().min(1, 'Token is required').max(255),
});

type Db = Pick<typeof prisma, 'pushToken'>;

/**
 * Saves the token for this account. Upserting by token moves a phone to whoever signed in last,
 * so the previous account's notifications stop reaching it.
 */
export async function savePushToken(userId: string, input: z.infer<typeof pushTokenSchema>, db: Db = prisma) {
    await db.pushToken.upsert({
        where: { token: input.token },
        update: { userId, platform: input.platform },
        create: { userId, token: input.token, platform: input.platform },
    });
    const stale = await db.pushToken.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip: MAX_TOKENS_PER_USER,
        select: { id: true },
    });
    if (stale.length) await db.pushToken.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
}

/** Removes this phone's token on sign-out. Only the signed-in account's own token can be removed. */
export async function removePushToken(userId: string, token: string, db: Db = prisma): Promise<number> {
    const { count } = await db.pushToken.deleteMany({ where: { userId, token } });
    return count;
}
