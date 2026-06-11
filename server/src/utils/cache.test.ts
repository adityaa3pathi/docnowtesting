import { describe, expect, it } from 'vitest';
import {
    getOrSetJsonCache,
    hashCacheValue,
    normalizeCoordinateForCache,
} from './cache';

describe('cache helpers', () => {
    it('normalizes coordinates for stable serviceability cache keys', () => {
        expect(normalizeCoordinateForCache('28.613939')).toBe('28.614');
        expect(normalizeCoordinateForCache('not-a-coordinate')).toBe('not-a-coordinate');
    });

    it('hashes equivalent structured values consistently', () => {
        const value = [{ deal_id: ['package_1', 'test_2'] }];
        expect(hashCacheValue(value)).toBe(hashCacheValue(value));
        expect(hashCacheValue(value)).toHaveLength(24);
    });

    it('falls back to the loader when Redis is not configured', async () => {
        let calls = 0;
        const value = await getOrSetJsonCache('test:no-redis', 60, async () => {
            calls += 1;
            return { ok: true };
        });

        expect(value).toEqual({ ok: true });
        expect(calls).toBe(1);
    });
});
