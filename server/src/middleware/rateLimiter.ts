/**
 * In-Memory Rate Limiter Middleware
 * 
 * Per-user rate limiting for payment endpoints. Uses a simple
 * sliding-window counter stored in a Map. Suitable for single-server
 * deployments (MVP). For multi-instance, swap to Redis-backed limiter.
 * 
 * Automatically cleans up expired entries every 5 minutes.
 */

interface RateLimitEntry {
    count: number;
    resetAt: number; // timestamp
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (entry.resetAt <= now) {
            store.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Creates a rate limiter middleware.
 * @param points  Max requests allowed in the window
 * @param durationSec  Window duration in seconds
 * @param keyPrefix  Prefix for rate limit keys
 */
export function rateLimiter(points: number, durationSec: number, keyPrefix: string = 'rl') {
    return (req: any, res: any, next: any) => {
        const userId = req.userId;
        if (!userId) return next(); // unauthenticated — skip (auth middleware will catch)

        const key = `${keyPrefix}:${userId}`;
        const now = Date.now();
        const entry = store.get(key);

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
            store.set(key, {
                count: 1,
                resetAt: now + durationSec * 1000
            });
        }

        next();
    };
}
