import { describe, expect, it } from 'vitest';
import { formatPaise, formatRupees } from './format';

describe('formatPaise', () => {
    it('converts whole paise to rupees without float drift', () => {
        expect(formatPaise(49999)).toBe('₹499.99');
        expect(formatPaise(50000)).toBe('₹500');
        expect(formatPaise(0)).toBe('₹0');
        expect(formatPaise(123456789)).toBe('₹12,34,567.89');
    });
});

describe('formatRupees', () => {
    it('shows rupees as given, so rupees and paise never mix', () => {
        expect(formatRupees(500)).toBe('₹500');
        expect(formatRupees(499.5)).toBe('₹499.5');
        expect(formatPaise(50000)).toBe(formatRupees(500));
    });
});
