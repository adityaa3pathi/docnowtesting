import { describe, expect, it } from 'vitest';
import type { Ratelimit } from '@upstash/ratelimit';
import { underLimit } from './rateLimit';

const limiter = (limit: () => Promise<{ success: boolean }>) => ({ limit } as unknown as Ratelimit);

describe('underLimit', () => {
    it('follows the limiter when Redis answers', async () => {
        expect(await underLimit(limiter(async () => ({ success: false })), 'cancel:u1')).toBe(false);
        expect(await underLimit(limiter(async () => ({ success: true })), 'cancel:u1')).toBe(true);
    });
    it('lets the request through when Redis is unreachable', async () => {
        expect(await underLimit(limiter(async () => { throw new TypeError('fetch failed'); }), 'cancel:u1')).toBe(true);
    });
});
