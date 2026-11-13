/**
 * Small HMAC-signed, expiring tokens for links that must open without the Authorization header
 * (in-app browsers, WhatsApp). Each kind has its own purpose string, so a token for one kind of
 * link can never be replayed as another.
 */
import crypto from 'crypto';

function secret() {
    const s = process.env.JWT_SECRET;
    if (!s) throw new Error('JWT secret is not configured');
    return s;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const fromB64url = (v: string) => Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sign = (purpose: string, body: string) => b64url(crypto.createHmac('sha256', secret()).update(`${purpose}.${body}`).digest());

export function createSignedToken(purpose: string, subject: string, hours: number, now = Date.now()): string {
    const body = b64url(JSON.stringify({ sub: subject, exp: now + hours * 3_600_000 }));
    return `${body}.${sign(purpose, body)}`;
}

/** The subject, or throws "Invalid link" / "This link has expired". */
export function verifySignedToken(purpose: string, token: string, now = Date.now()): string {
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new Error('Invalid link');
    const expected = sign(purpose, body);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid link');
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') throw new Error('Invalid link');
    if (payload.exp < now) throw new Error('This link has expired');
    return payload.sub;
}
