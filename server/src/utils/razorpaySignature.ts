/**
 * Razorpay signature checks. Both fail closed: an empty secret or a missing signature is a
 * plain `false`, never a throw, so a misconfigured secret cannot let requests through.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function matches(expectedHex: string, givenHex: string | undefined): boolean {
    if (!givenHex || !/^[0-9a-f]+$/i.test(givenHex)) return false;
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(givenHex, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string | undefined, keySecret: string | undefined): boolean {
    if (!keySecret) return false;
    const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    return matches(expected, signature);
}

export function verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined, webhookSecret: string | undefined): boolean {
    if (!webhookSecret) return false;
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return matches(expected, signature);
}
