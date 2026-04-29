import { Request, Response } from 'express';

export function isWebClient(req: Request): boolean {
    const clientType = req.headers['x-client-type'];
    return !clientType || clientType === 'web';
}

interface Tokens {
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
}

const ACCESS_COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 15 * 60 * 1000 // 15 mins
};

const REFRESH_COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth', // Only sent to auth endpoints
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
};

const CSRF_COOKIE_OPTS = {
    httpOnly: false, // JS needs to read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
};

export function setAuthResponse(req: Request, res: Response, tokens: Tokens, user: any = null) {
    if (isWebClient(req)) {
        // Web: Tokens in HttpOnly cookies (except CSRF which is accessible to JS), User in body
        res.cookie('docnow_access', tokens.accessToken, ACCESS_COOKIE_OPTS);
        res.cookie('docnow_refresh', tokens.refreshToken, REFRESH_COOKIE_OPTS);
        res.cookie('docnow_csrf', tokens.csrfToken, CSRF_COOKIE_OPTS);
        
        if (user) {
            res.status(200).json({ user });
        } else {
            res.status(200).json({ success: true });
        }
    } else {
        // Mobile: Tokens in response body, no cookies
        const responseData: any = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
        };
        if (user) {
            responseData.user = user;
        }
        res.status(200).json(responseData);
    }
}

export function clearAuthCookies(res: Response) {
    res.clearCookie('docnow_access', { ...ACCESS_COOKIE_OPTS, maxAge: 0 });
    res.clearCookie('docnow_refresh', { ...REFRESH_COOKIE_OPTS, maxAge: 0 });
    res.clearCookie('docnow_csrf', { ...CSRF_COOKIE_OPTS, maxAge: 0 });
}
