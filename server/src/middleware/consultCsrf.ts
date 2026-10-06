import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * CSRF guard for consultation routes. Unlike the global one, it ignores the mobile client
 * header whenever auth cookies are present, so a browser cannot skip the token by sending it.
 */
export function consultCsrfGuard(req: Request, res: Response, next: NextFunction) {
    if (SAFE_METHODS.includes(req.method)) return next();
    if (!req.cookies?.docnow_access && !req.cookies?.docnow_refresh) return next();

    const cookie = req.cookies?.docnow_csrf;
    const header = req.headers['x-docnow-csrf'];
    if (typeof cookie !== 'string' || typeof header !== 'string' || !cookie) {
        return res.status(403).json({ error: 'CSRF validation failed' });
    }
    const a = Buffer.from(cookie);
    const b = Buffer.from(header);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return res.status(403).json({ error: 'CSRF validation failed' });
    }
    next();
}
