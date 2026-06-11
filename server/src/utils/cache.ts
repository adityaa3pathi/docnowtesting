import crypto from 'crypto';
import { redis } from './rateLimit';
import { logger } from './logger';

type CacheMeta = Record<string, unknown>;

const CACHE_OPERATION_TIMEOUT_MS = Math.max(100, Number(process.env.CACHE_OPERATION_TIMEOUT_MS || 750));

function withCacheTimeout<T>(promise: Promise<T>, operation: string, key: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error(`${operation} timed out after ${CACHE_OPERATION_TIMEOUT_MS}ms for ${key}`)),
            CACHE_OPERATION_TIMEOUT_MS,
        );

        promise
            .then((value) => {
                clearTimeout(timeout);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timeout);
                reject(error);
            });
    });
}

function safeJsonParse<T>(value: unknown): T | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as T;
        } catch {
            return null;
        }
    }
    if (typeof value === 'object') return value as T;
    return null;
}

export function hashCacheValue(value: unknown) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export function normalizeCoordinateForCache(value: string | number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return String(value || '').trim();
    return parsed.toFixed(3);
}

export async function getJsonCache<T>(key: string): Promise<T | null> {
    if (!redis) return null;

    try {
        const value = await withCacheTimeout(redis.get(key), 'cache_get', key);
        return safeJsonParse<T>(value);
    } catch (error) {
        logger.warn({ error, cacheKey: key }, 'cache_read_failed');
        return null;
    }
}

export async function setJsonCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!redis || ttlSeconds <= 0) return;

    try {
        await withCacheTimeout(redis.set(key, JSON.stringify(value), { ex: ttlSeconds }), 'cache_set', key);
    } catch (error) {
        logger.warn({ error, cacheKey: key, ttlSeconds }, 'cache_write_failed');
    }
}

export async function getOrSetJsonCache<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    meta: CacheMeta = {},
): Promise<T> {
    const cached = await getJsonCache<T>(key);
    if (cached !== null) {
        logger.debug({ cacheKey: key, ...meta }, 'cache_hit');
        return cached;
    }

    const value = await loader();
    await setJsonCache(key, value, ttlSeconds);
    logger.debug({ cacheKey: key, ttlSeconds, ...meta }, 'cache_miss_stored');
    return value;
}
