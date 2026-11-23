import { describe, expect, it } from 'vitest';
import { bookedPriceLines, bookingTotalPaise, consultPrice, priceLines, refundDestination, walletRupeesToPaise } from './price';

describe('consultPrice', () => {
    it('takes what the wallet covers and leaves the rest for the card', () => {
        expect(consultPrice(50000, 20000, true)).toEqual({ feePaise: 50000, discountPaise: 0, walletPaise: 20000, payPaise: 30000 });
    });
    it('never leaves the card less than ₹1 (Razorpay minimum)', () => {
        expect(consultPrice(50000, 49950, true)).toEqual({ feePaise: 50000, discountPaise: 0, walletPaise: 49900, payPaise: 100 });
        expect(consultPrice(50000, 50000, true)).toEqual({ feePaise: 50000, discountPaise: 0, walletPaise: 50000, payPaise: 0 });
    });
    it('never takes more than the fee', () => {
        expect(consultPrice(50000, 75050, true)).toEqual({ feePaise: 50000, discountPaise: 0, walletPaise: 50000, payPaise: 0 });
    });
    it('leaves the wallet alone when switched off', () => {
        expect(consultPrice(50000, 20000, false)).toEqual({ feePaise: 50000, discountPaise: 0, walletPaise: 0, payPaise: 50000 });
    });
});

describe('consultPrice with a promo', () => {
    it('takes the discount off first, then the wallet covers the rest', () => {
        expect(consultPrice(50000, 30000, true, 10000)).toEqual({ feePaise: 50000, discountPaise: 10000, walletPaise: 30000, payPaise: 10000 });
        expect(consultPrice(50000, 0, false, 60000)).toEqual({ feePaise: 50000, discountPaise: 50000, walletPaise: 0, payPaise: 0 });
    });
    it('lists fee, promo and wallet lines', () => {
        const fmt = (p: number) => `₹${p / 100}`;
        expect(priceLines(consultPrice(50000, 30000, true, 10000), fmt, 'DOC20')).toEqual([
            { label: 'Consultation fee', value: '₹500' },
            { label: 'Promo DOC20', value: '− ₹100' },
            { label: 'From DocNow wallet', value: '− ₹300' },
        ]);
        expect(priceLines(consultPrice(50000, 0, false), fmt)).toBeUndefined();
    });
    it('a booked promo booking shows the discount and the paid amount', () => {
        const fmt = (p: number) => `₹${p / 100}`;
        const b = { amountPaise: 40000, feePaise: 50000, walletPaise: 0, discountPaise: 10000, promoCode: 'DOC20', status: 'CONFIRMED', paymentCaptured: true };
        expect(bookedPriceLines(b, fmt)).toEqual({
            lines: [{ label: 'Consultation fee', value: '₹500' }, { label: 'Promo DOC20', value: '− ₹100' }],
            amountLabel: 'Paid by card/UPI',
            amount: '₹400',
        });
        expect(bookingTotalPaise(b)).toBe(40000);
        expect(bookedPriceLines({ ...b, amountPaise: 0, discountPaise: 50000, paymentCaptured: false }, fmt).amountLabel).toBe('You paid');
        // A hold that ended unpaid gave the code back: the full fee, no promo line.
        expect(bookedPriceLines({ ...b, status: 'EXPIRED', paymentCaptured: false }, fmt)).toEqual({ lines: undefined, amountLabel: 'Amount', amount: '₹500' });
        expect(bookingTotalPaise({ ...b, status: 'EXPIRED', paymentCaptured: false })).toBe(50000);
        expect(bookingTotalPaise({ ...b, status: 'PENDING_PAYMENT', paymentCaptured: false })).toBe(40000);
    });
});

describe('walletRupeesToPaise', () => {
    it('rounds float balances to whole paise like the server', () => {
        expect(walletRupeesToPaise(0.1 + 0.2)).toBe(30);
        expect(walletRupeesToPaise(123.45)).toBe(12345);
        expect(walletRupeesToPaise(99.999)).toBe(10000);
    });
    it('treats missing or negative balances as nothing', () => {
        expect(walletRupeesToPaise(undefined)).toBe(0);
        expect(walletRupeesToPaise(-5)).toBe(0);
        expect(walletRupeesToPaise(Number.NaN)).toBe(0);
    });
});

describe('booked price lines and refund text', () => {
    const fmt = (p: number) => `₹${p / 100}`;
    it('shows only the amount when no wallet was used', () => {
        expect(bookedPriceLines({ amountPaise: 50000, feePaise: 50000, walletPaise: 0, status: 'CONFIRMED', paymentCaptured: true }, fmt)).toEqual({ lines: undefined, amountLabel: 'Amount', amount: '₹500' });
    });
    it('splits fee, wallet and card for a part-wallet booking', () => {
        expect(bookedPriceLines({ amountPaise: 30000, feePaise: 50000, walletPaise: 20000, status: 'CONFIRMED', paymentCaptured: true }, fmt)).toEqual({
            lines: [{ label: 'Consultation fee', value: '₹500' }, { label: 'From DocNow wallet', value: '− ₹200' }],
            amountLabel: 'Paid by card/UPI',
            amount: '₹300',
        });
        expect(bookedPriceLines({ amountPaise: 30000, feePaise: 50000, walletPaise: 20000, status: 'PENDING_PAYMENT', paymentCaptured: false }, fmt).amountLabel).toBe('To pay now');
    });
    it('a hold that ended unpaid shows just the fee, no wallet line', () => {
        for (const status of ['CANCELLED', 'EXPIRED']) {
            expect(bookedPriceLines({ amountPaise: 30000, feePaise: 50000, walletPaise: 20000, status, paymentCaptured: false }, fmt)).toEqual({ lines: undefined, amountLabel: 'Amount', amount: '₹500' });
        }
    });
    it('says the wallet paid it all', () => {
        expect(bookedPriceLines({ amountPaise: 0, feePaise: 50000, walletPaise: 50000, status: 'CONFIRMED', paymentCaptured: true }, fmt)).toEqual({ lines: undefined, amountLabel: 'Paid from DocNow wallet', amount: '₹500' });
    });
    it('totals card and wallet, and copes with older servers', () => {
        expect(bookingTotalPaise({ amountPaise: 30000, feePaise: 50000 })).toBe(50000);
        expect(bookingTotalPaise({ amountPaise: 50000 })).toBe(50000);
    });
    it('names where each part of a refund goes', () => {
        expect(refundDestination(25000, 10000, fmt)).toBe('₹100 back to your DocNow wallet and ₹150 to your card/UPI');
        expect(refundDestination(50000, 50000, fmt)).toBe('₹500 back to your DocNow wallet');
        expect(refundDestination(50000, 0, fmt)).toBe('₹500 to your card/UPI');
        expect(refundDestination(50000, undefined, fmt)).toBe('₹500 to your card/UPI');
    });
});
