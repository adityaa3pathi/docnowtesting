import crypto from 'crypto';

const INVOICE_LINK_EXPIRY_HOURS = Number(process.env.INVOICE_LINK_EXPIRY_HOURS || '72');

type InvoiceTokenPayload = {
    bookingId: string;
    exp: number;
};

function getSigningSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT secret is not configured');
    }
    return secret;
}

function toBase64Url(value: string | Buffer) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(`${normalized}${padding}`, 'base64');
}

function signPayload(encodedPayload: string) {
    return toBase64Url(
        crypto.createHmac('sha256', getSigningSecret()).update(encodedPayload).digest()
    );
}

export function createInvoiceAccessToken(bookingId: string) {
    const payload: InvoiceTokenPayload = {
        bookingId,
        exp: Date.now() + (INVOICE_LINK_EXPIRY_HOURS * 60 * 60 * 1000),
    };

    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = signPayload(encodedPayload);

    return `${encodedPayload}.${signature}`;
}

export function verifyInvoiceAccessToken(token: string) {
    const [encodedPayload, providedSignature] = token.split('.');

    if (!encodedPayload || !providedSignature) {
        throw new Error('Invalid invoice token');
    }

    const expectedSignature = signPayload(encodedPayload);
    if (providedSignature.length !== expectedSignature.length) {
        throw new Error('Invalid invoice token');
    }
    const signatureMatches = crypto.timingSafeEqual(
        Buffer.from(providedSignature),
        Buffer.from(expectedSignature)
    );

    if (!signatureMatches) {
        throw new Error('Invalid invoice token');
    }

    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8')) as InvoiceTokenPayload;

    if (!payload.bookingId || !payload.exp || payload.exp < Date.now()) {
        throw new Error('Invoice link has expired');
    }

    return payload;
}

export function getInvoiceLinkExpiryHours() {
    return INVOICE_LINK_EXPIRY_HOURS;
}
