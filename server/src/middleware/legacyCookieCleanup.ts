/**
 * ==========================================
 * LEGACY COOKIE CLEANUP MIDDLEWARE
 * ==========================================
 * 
 * One-time cleanup middleware to expire cookies that were set
 * WITHOUT a domain attribute (before NODE_ENV=production was configured).
 * 
 * Those legacy cookies are scoped to `api.docnow.in` only and conflict
 * with the properly-scoped `.docnow.in` cookies, causing CSRF mismatches
 * and "Session revoked" loops for returning users.
 *
 * How it works:
 * - On every response, we send Set-Cookie headers to expire the legacy
 *   cookies (no domain = matches the exact origin that set them).
 * - We use a marker cookie `docnow_migrated` to avoid doing this on
 *   every single request — once cleaned, we skip future requests.
 * 
 * This middleware can be safely removed after ~30 days (around June 15, 2026)
 * once all active sessions have rotated.
 */

import { Request, Response, NextFunction } from 'express';

export function legacyCookieCleanup(req: Request, res: Response, next: NextFunction) {
    // Skip if already migrated (marker cookie present)
    if (req.cookies?.docnow_migrated) {
        return next();
    }

    // Expire legacy cookies that were set WITHOUT a domain.
    // These only match cookies scoped to the exact origin (api.docnow.in).
    // We must NOT set a domain here — that's the whole point: we're targeting
    // the domainless cookies specifically.
    const expireOpts = { path: '/', maxAge: 0 } as const;
    res.clearCookie('docnow_access', expireOpts);
    res.clearCookie('docnow_csrf', expireOpts);
    res.clearCookie('docnow_refresh', { path: '/api/auth', maxAge: 0 });

    // Set a marker so we don't repeat this on every request
    res.cookie('docnow_migrated', '1', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    next();
}
