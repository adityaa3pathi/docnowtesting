import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { prisma } from '../db';

/**
 * Requires the DOCTOR role. Must be used AFTER authMiddleware.
 * Doctors never inherit manager or admin powers, and vice versa.
 */
export async function requireDoctor(
    req: AuthRequest,
    res: Response,
    next: NextFunction
) {
    try {
        if (!req.userId) {
            return res.status(401).json({ error: 'Unauthorized: No user ID' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: { id: true, role: true, status: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: User not found' });
        }

        if (user.status === 'BLOCKED') {
            return res.status(403).json({ error: 'Forbidden: Account is blocked' });
        }

        if (user.role !== 'DOCTOR') {
            return res.status(403).json({ error: 'Forbidden: Doctor access required' });
        }

        next();
    } catch (error) {
        console.error('[DoctorAuth] Error checking doctor role:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
