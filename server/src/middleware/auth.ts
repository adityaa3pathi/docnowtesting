import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';

export interface AuthRequest extends Request {
    userId?: string;
    adminId?: string;
    adminName?: string;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authorization token missing' });
        return;
    }

    const token = authHeader.split(' ')[1];

    // Debug: log token format (first 20 chars for safety)
    console.log('[Auth] Token received:', token?.substring(0, 30) + '...');

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        req.userId = decoded.userId;
        next();
    } catch (error) {
        console.error('JWT Verification Error:', error);
        console.error('[Auth] Full token was:', token);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
