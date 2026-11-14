import { describe, expect, it } from 'vitest';
import { collectAmount, isFullyCollected } from './payOnCollection';
import { isRealOnlinePayment } from './refunds';

describe('pay on collection money rules', () => {
    it('collects whole rupees and gives the paisa to the customer as discount', () => {
        expect(collectAmount(899.6)).toEqual({ collect: 899, extraDiscount: expect.closeTo(0.6, 5) });
        expect(collectAmount(500)).toEqual({ collect: 500, extraDiscount: 0 });
    });

    it('treats a payment as collected only when it covers the amount due', () => {
        expect(isFullyCollected('899', 899)).toBe(true);
        expect(isFullyCollected(900, 899)).toBe(true);
        expect(isFullyCollected('500', 899)).toBe(false);
        expect(isFullyCollected('', 899)).toBe(false);
        expect(isFullyCollected(undefined, 899)).toBe(false);
    });

    it('never sends a Razorpay refund for a pay-on-collection or wallet placeholder', () => {
        expect(isRealOnlinePayment('COD_abc')).toBe(false);
        expect(isRealOnlinePayment('ZERO_abc')).toBe(false);
        expect(isRealOnlinePayment('pay_N1x2y3')).toBe(true);
    });
});
