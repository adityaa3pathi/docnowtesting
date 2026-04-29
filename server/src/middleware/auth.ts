import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
}

export interface AuthRequest extends Request {
    userId?: string;
    adminId?: string;
    adminName?: string;
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
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; tokenVersion: number };
        
        // Check user status and tokenVersion
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, status: true, tokenVersion: true }
        });

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

        req.userId = user.id;
        next();
    } catch (error) {
        console.error('JWT Verification Error:', error);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
