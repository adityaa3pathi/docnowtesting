import { beforeEach, describe, expect, it } from 'vitest';
import { attemptKey, forgetAttemptKey } from './idempotency';

class MemoryStorage {
    private data = new Map<string, string>();
    getItem(k: string) { return this.data.get(k) ?? null; }
    setItem(k: string, v: string) { this.data.set(k, v); }
    removeItem(k: string) { this.data.delete(k); }
}

describe('attemptKey', () => {
    beforeEach(() => {
        (globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
    });

    it('reuses the key for the same slot and person, and differs for another', () => {
        const a = attemptKey('slot-1', 'person-1');
        expect(attemptKey('slot-1', 'person-1')).toBe(a);
        expect(attemptKey('slot-2', 'person-1')).not.toBe(a);
        expect(attemptKey('slot-1', 'person-2')).not.toBe(a);
    });
    it('makes a fresh key after the old one is forgotten', () => {
        const a = attemptKey('slot-1', 'person-1');
        forgetAttemptKey('slot-1', 'person-1');
        expect(attemptKey('slot-1', 'person-1')).not.toBe(a);
    });
    it('makes keys the server accepts', () => {
        expect(attemptKey('s', 'p')).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });
    it('still works when storage is unavailable', () => {
        delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
        expect(attemptKey('s', 'p')).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });
});
