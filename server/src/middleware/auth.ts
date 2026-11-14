import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { logger } from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
}

export interface AuthRequest extends Request {
    userId?: string;
    adminId?: string;
    adminName?: string;
}

/**
 * Logout and stolen-token detection revoke a session; without this its access token kept working
 * for up to 15 minutes. A session revoked by normal rotation has a successor and stays usable
 * until its short-lived token expires, so refreshing never logs anyone out.
 */
export function isSessionUsable(session: { revokedAt: Date | null; replacedById: string | null } | null | undefined): boolean {
    if (session === undefined) return true; // token issued before sessions were embedded
    if (session === null) return false;
    return !session.revokedAt || !!session.replacedById;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    // Extract token: First check cookies (web), then Authorization header (mobile/fallback)
    let token = req.cookies?.docnow_access;

    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
    }

    if (!token) {
        res.status(401).json({ error: 'Authorization token missing' });
        return;
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; tokenVersion: number; sessionId?: string };

        // Check user status and tokenVersion, and that the token's own session was not ended
        const [user, session] = await Promise.all([
            prisma.user.findUnique({
                where: { id: decoded.userId },
                select: { id: true, status: true, tokenVersion: true }
            }),
            decoded.sessionId
                ? prisma.session.findUnique({ where: { id: decoded.sessionId }, select: { revokedAt: true, replacedById: true } })
                : Promise.resolve(undefined),
        ]);

        if (!user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }

        if (user.status === 'BLOCKED') {
            res.status(401).json({ error: 'Account is blocked' });
            return;
        }

        if (user.tokenVersion !== decoded.tokenVersion) {
            res.status(401).json({ error: 'Session expired. Please log in again.' });
            return;
        }

        if (!isSessionUsable(session)) {
            res.status(401).json({ error: 'Session expired. Please log in again.' });
            return;
        }

        req.userId = user.id;
        next();
    } catch (error) {
        logger.warn({ error }, 'access_token_verification_failed');
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
