/**
 * Express "trust proxy" from TRUST_PROXY. Default "loopback": Nginx on the same box, so req.ip is
 * the real visitor and a client-sent X-Forwarded-For can't spoof it. Set a hop count or CIDRs
 * (e.g. Cloudflare ranges) if another proxy sits in front.
 */
export function trustProxySetting(value = process.env.TRUST_PROXY): boolean | number | string {
    const v = value?.trim();
    if (!v) return 'loopback';
    if (v === 'true') return true;
    if (v === 'false') return false;
    return /^\d+$/.test(v) ? Number(v) : v;
}
