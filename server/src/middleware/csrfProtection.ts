import { Request, Response, NextFunction } from 'express';

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
    // 1. Skip for mobile clients (no cookies = no CSRF risk)
    if (req.headers['x-client-type'] === 'mobile') {
        return next();
    }

    // 2. Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // 3. Skip if request has no auth cookies at all (unauthenticated)
    if (!req.cookies?.docnow_access && !req.cookies?.docnow_refresh) {
        return next();
    }

    // 4. Require CSRF token matching
    const cookieToken = req.cookies?.docnow_csrf;
    const headerToken = req.headers['x-docnow-csrf'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: 'CSRF validation failed' });
    }

    next();
}
