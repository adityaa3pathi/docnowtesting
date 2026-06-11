import { describe, expect, it } from 'vitest';
import { PaymentStatus } from '@prisma/client';
import { assertTransition, buildConditionalUpdate, canTransition } from './paymentStateMachine';

describe('paymentStateMachine', () => {
    it('allows expected happy-path payment transitions', () => {
        expect(canTransition(PaymentStatus.INITIATED, PaymentStatus.AUTHORIZED)).toBe(true);
        expect(canTransition(PaymentStatus.AUTHORIZED, PaymentStatus.PROCESSING)).toBe(true);
        expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.CONFIRMED)).toBe(true);
    });

    it('allows recovery and refund paths for partner failures', () => {
        expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.PARTNER_FAILED)).toBe(true);
        expect(canTransition(PaymentStatus.PARTNER_FAILED, PaymentStatus.PROCESSING)).toBe(true);
        expect(canTransition(PaymentStatus.PARTNER_FAILED, PaymentStatus.REFUNDED)).toBe(true);
    });

    it('blocks terminal states from being reopened', () => {
        expect(canTransition(PaymentStatus.FAILED, PaymentStatus.AUTHORIZED)).toBe(false);
        expect(canTransition(PaymentStatus.CANCELLED, PaymentStatus.PROCESSING)).toBe(false);
        expect(canTransition(PaymentStatus.REFUNDED, PaymentStatus.CONFIRMED)).toBe(false);
    });

    it('throws when an invalid transition is asserted', () => {
        expect(() => assertTransition(PaymentStatus.CONFIRMED, PaymentStatus.PROCESSING))
            .toThrow('Invalid payment state transition: CONFIRMED');
    });

    it('builds a conditional update only after validating the transition', () => {
        expect(buildConditionalUpdate('booking-1', PaymentStatus.INITIATED, PaymentStatus.AUTHORIZED)).toEqual({
            where: { id: 'booking-1', paymentStatus: PaymentStatus.INITIATED },
            data: { paymentStatus: PaymentStatus.AUTHORIZED },
        });
    });
});
