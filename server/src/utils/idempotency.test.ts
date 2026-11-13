import { describe, expect, it } from 'vitest';
import type { Redis } from '@upstash/redis';
import { claimOnce } from './idempotency';

function fakeRedis() {
    const keys = new Set<string>();
    return {
        keys,
        set: async (k: string) => (keys.has(k) ? null : (keys.add(k), 'OK')),
        del: async (k: string) => Number(keys.delete(k)),
    } as unknown as Redis & { keys: Set<string> };
}

describe('claimOnce', () => {
    it('lets the first call through and stops a repeat of the same key', async () => {
        const store = fakeRedis();
        expect((await claimOnce('cart-add', 'u1', 'key-12345678', store)).status).toBe('first');
        expect((await claimOnce('cart-add', 'u1', 'key-12345678', store)).status).toBe('repeat');
        expect((await claimOnce('cart-add', 'u2', 'key-12345678', store)).status).toBe('first');
    });

    it('frees the key when the write fails, so a retry works', async () => {
        const store = fakeRedis();
        const claim = await claimOnce('cart-add', 'u1', 'key-12345678', store);
        if (claim.status === 'first') await claim.release();
        expect((await claimOnce('cart-add', 'u1', 'key-12345678', store)).status).toBe('first');
    });

    it('goes unguarded without a valid key or when Redis is down', async () => {
        const store = fakeRedis();
        expect((await claimOnce('cart-add', 'u1', undefined, store)).status).toBe('unchecked');
        expect((await claimOnce('cart-add', 'u1', 'bad key!', store)).status).toBe('unchecked');
        const down = { set: async () => { throw new TypeError('fetch failed'); } } as unknown as Redis;
        expect((await claimOnce('cart-add', 'u1', 'key-12345678', down)).status).toBe('unchecked');
    });
});
