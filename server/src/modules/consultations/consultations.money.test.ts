import { describe, expect, it } from 'vitest';
import { feeFromBps, refundForPercent, remainingRefundable, toPaise } from './consultations.money';

describe('toPaise', () => {
    it('converts rupees without float drift', () => {
        expect(toPaise(499.99)).toBe(49999);
        expect(toPaise(1.15)).toBe(115);
        expect(toPaise(0)).toBe(0);
    });
    it('rejects negative and non-finite amounts', () => {
        expect(() => toPaise(-1)).toThrow();
        expect(() => toPaise(Number.NaN)).toThrow();
    });
});

describe('feeFromBps', () => {
    it('takes a percentage in basis points, rounding half up', () => {
        expect(feeFromBps(49900, 1200)).toBe(5988);
        expect(feeFromBps(1005, 1000)).toBe(101);
        expect(feeFromBps(1004, 1000)).toBe(100);
    });
    it('returns 0 for a zero fee', () => {
        expect(feeFromBps(49900, 0)).toBe(0);
    });
});

describe('refundForPercent', () => {
    it('rounds half up once on the total and never exceeds paid', () => {
        expect(refundForPercent(49999, 50)).toBe(25000);
        expect(refundForPercent(49999, 100)).toBe(49999);
        expect(refundForPercent(49999, 0)).toBe(0);
        expect(refundForPercent(100, 101)).toBe(100);
    });
});

describe('remainingRefundable', () => {
    it('never goes below zero', () => {
        expect(remainingRefundable(10000, 12000)).toBe(0);
        expect(remainingRefundable(10000, 2500)).toBe(7500);
    });
});
