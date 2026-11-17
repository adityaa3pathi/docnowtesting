import { describe, expect, it } from 'vitest';
import { RazorpayError, withTimeout } from './consultations.razorpay';

describe('withTimeout', () => {
    it('returns the result when the call finishes in time', async () => {
        await expect(withTimeout(async () => 'ok', 200)).resolves.toBe('ok');
    });
    it('rejects with a network error when the call hangs', async () => {
        const hang = () => new Promise<string>(() => {});
        await expect(withTimeout(hang, 20)).rejects.toMatchObject({ kind: 'network' });
        await expect(withTimeout(hang, 20)).rejects.toBeInstanceOf(RazorpayError);
    });
    it('passes the original error through', async () => {
        const boom = new Error('boom');
        await expect(withTimeout(async () => { throw boom; }, 200)).rejects.toBe(boom);
    });
});
