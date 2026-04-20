import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { Request, Response, NextFunction } from 'express';

// Fallback in-memory store if Redis is unconfigured
const fallbackStore = new Map<string, { count: number; resetAt: number }>();

// Cleanup expired entries every 5 minutes (for fallback)
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of fallbackStore) {
        if (entry.resetAt <= now) {
            fallbackStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

let ratelimitCache: Record<string, Ratelimit> = {};
let redisClient: Redis | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redisClient = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
} else {
    console.warn("⚠️ UPSTASH_REDIS_REST_URL missing. Using local memory for rate limiting (NOT production safe for multi-instance!).");
}

/**
 * Creates a rate limiter middleware backed by Redis distributed sliding window.
 * @param points  Max requests allowed in the window
 * @param durationSec  Window duration in seconds
 * @param keyPrefix  Prefix for rate limit keys
 */
export function rateLimiter(points: number, durationSec: number, keyPrefix: string = 'rl') {
    // If Redis is configured, prepare Upstash limiter
    let upstashLimiter: Ratelimit | null = null;
    if (redisClient) {
        const cacheKey = `${points}:${durationSec}:${keyPrefix}`;
        if (!ratelimitCache[cacheKey]) {
            ratelimitCache[cacheKey] = new Ratelimit({
                redis: redisClient,
                limiter: Ratelimit.slidingWindow(points, `${durationSec} s`),
                prefix: `ratelimit:${keyPrefix}`,
            });
        }
        upstashLimiter = ratelimitCache[cacheKey];
    }

    return async (req: Request, res: Response, next: NextFunction) => {
        // We identify user by ID if authenticated, else IPv4 address, else anonymous
        let ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
        if (Array.isArray(ip)) ip = ip[0];
        
        const identifier = (req as any).userId || ip || 'anonymous';
        const key = `${keyPrefix}:${identifier}`;

        if (upstashLimiter) {
            try {
                const { success, limit, remaining, reset } = await upstashLimiter.limit(identifier as string);
                res.setHeader('X-RateLimit-Limit', limit);
                res.setHeader('X-RateLimit-Remaining', remaining);
                res.setHeader('X-RateLimit-Reset', reset);

                if (!success) {
                    const retryAfter = Math.ceil((reset - Date.now()) / 1000);
                    res.set('Retry-After', String(retryAfter));
                    return res.status(429).json({
                        error: 'Too many requests. Please wait before trying again.',
                        retryAfter
                    });
                }
                return next();
            } catch (err) {
                console.error("Redis Rate Limiter Error (falling back to next):", err);
                return next();
            }
        } else {
            // Fallback logic
            const now = Date.now();
            const entry = fallbackStore.get(key);

            if (entry && entry.resetAt > now) {
                if (entry.count >= points) {
                    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
                    res.set('Retry-After', String(retryAfter));
                    return res.status(429).json({
                        error: 'Too many requests. Please wait before trying again.',
                        retryAfter
                    });
                }
                entry.count++;
            } else {
                fallbackStore.set(key, {
                    count: 1,
                    resetAt: now + durationSec * 1000
                });
            }
            return next();
        }
    };
}
