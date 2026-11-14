import type { Redis } from '@upstash/redis';
import { redis as sharedRedis } from './rateLimit';
import { logger } from './logger';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;
const DAY_SECONDS = 24 * 60 * 60;

export type Claim = { status: 'first'; release: () => Promise<void> } | { status: 'repeat' } | { status: 'unchecked' };

/**
 * Claims a client-sent Idempotency-Key once per user and route for 24 hours.
 * 'unchecked' (no key, bad key, or Redis down) means: go ahead without a guard.
 */
export async function claimOnce(scope: string, userId: string, key: unknown, store: Redis | null = sharedRedis): Promise<Claim> {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key) || !store) return { status: 'unchecked' };
    const redisKey = `idem:${scope}:${userId}:${key}`;
    try {
        const won = await store.set(redisKey, '1', { nx: true, ex: DAY_SECONDS });
        if (!won) return { status: 'repeat' };
        // A failed write must free the key, or the customer's retry would be ignored.
        return { status: 'first', release: async () => { await store.del(redisKey).catch(() => undefined); } };
    } catch (err) {
        logger.warn({ error: err, scope }, 'idempotency_redis_unavailable');
        return { status: 'unchecked' };
    }
}
