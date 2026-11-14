import { Redis } from '@upstash/redis';
import type { Ratelimit } from '@upstash/ratelimit';
import dotenv from 'dotenv';
import { logger } from './logger';
dotenv.config();

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis = (redisUrl && redisToken)
    ? new Redis({ url: redisUrl, token: redisToken })
    : null;

if (!redis) {
    console.warn('UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing. Rate limiting is disabled.');
}

/** True when the call may go ahead. If Redis is unreachable we allow it: a lost limit beats a failed cancel. */
export async function underLimit(limiter: Ratelimit | null, key: string): Promise<boolean> {
    if (!limiter) return true;
    try {
        return (await limiter.limit(key)).success;
    } catch (err) {
        logger.warn({ error: err, key: key.split(':')[0] }, 'rate_limit_redis_unavailable');
        return true;
    }
}
