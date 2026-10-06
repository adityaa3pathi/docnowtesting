import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyCheckoutSignature, verifyWebhookSignature } from './razorpaySignature';

const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('hex');

describe('verifyCheckoutSignature', () => {
    const secret = 'key_secret';
    const good = sign('order_1|pay_1', secret);
    it('accepts a valid signature', () => {
        expect(verifyCheckoutSignature('order_1', 'pay_1', good, secret)).toBe(true);
    });
    it('rejects a wrong, empty or different-length signature without throwing', () => {
        expect(verifyCheckoutSignature('order_1', 'pay_1', sign('order_1|pay_2', secret), secret)).toBe(false);
        expect(verifyCheckoutSignature('order_1', 'pay_1', '', secret)).toBe(false);
        expect(verifyCheckoutSignature('order_1', 'pay_1', 'abc', secret)).toBe(false);
    });
    it('fails closed when the secret is empty or missing', () => {
        expect(verifyCheckoutSignature('order_1', 'pay_1', sign('order_1|pay_1', ''), '')).toBe(false);
        expect(verifyCheckoutSignature('order_1', 'pay_1', good, undefined)).toBe(false);
    });
});

describe('verifyWebhookSignature', () => {
    const secret = 'whsec';
    const body = Buffer.from('{"event":"payment.captured"}');
    it('accepts a valid signature over the raw body', () => {
        expect(verifyWebhookSignature(body, sign(body.toString(), secret), secret)).toBe(true);
    });
    it('rejects a tampered body, a missing header and a malformed header', () => {
        expect(verifyWebhookSignature(Buffer.from('{"event":"x"}'), sign(body.toString(), secret), secret)).toBe(false);
        expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
        expect(verifyWebhookSignature(body, 'not-hex', secret)).toBe(false);
    });
    it('fails closed on an empty or missing secret', () => {
        expect(verifyWebhookSignature(body, sign(body.toString(), ''), '')).toBe(false);
        expect(verifyWebhookSignature(body, sign(body.toString(), 'x'), undefined)).toBe(false);
    });
});
