import { Request, Response, NextFunction } from 'express';

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
    // 1. Skip for mobile clients (no cookies = no CSRF risk)
    if (req.headers['x-client-type'] === 'mobile') {
        return next();
    }

    // 2. Skip for safe (read-only) HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // 3. Skip ALL auth endpoints — these issue the CSRF token in the first place
    //    Actual routes: /api/auth/login/password, /api/auth/signup/send-otp, /api/auth/refresh, etc.
    const url = req.originalUrl.split('?')[0];
    if (url.startsWith('/api/auth/')) {
        return next();
    }

    // 4. Skip public form endpoints (callback requests, corporate inquiries)
    if (url.startsWith('/api/callback') || url.startsWith('/api/corporate-inquiries')) {
        return next();
    }

    // 5. Skip if request has no auth cookies at all (unauthenticated)
    if (!req.cookies?.docnow_access && !req.cookies?.docnow_refresh) {
        return next();
    }

    // 6. Require CSRF token matching for authenticated, state-changing requests
    const cookieToken = req.cookies?.docnow_csrf;
    const headerToken = req.headers['x-docnow-csrf'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: 'CSRF validation failed' });
    }

    next();
}
