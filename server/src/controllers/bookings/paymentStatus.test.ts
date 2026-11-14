import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({ prisma: {} }));
const { checkoutOutcome } = await import('./paymentStatus');

describe('checkoutOutcome', () => {
    it('only says confirmed when the lab booking exists', () => {
        expect(checkoutOutcome('CONFIRMED')).toBe('confirmed');
        for (const s of ['INITIATED', 'AUTHORIZED', 'PAID', 'PROCESSING', 'PARTNER_FAILED']) expect(checkoutOutcome(s)).toBe('pending');
        expect(checkoutOutcome('REFUNDED')).toBe('refunded');
        for (const s of ['FAILED', 'EXPIRED', 'CANCELLED']) expect(checkoutOutcome(s)).toBe('not_paid');
    });
});
