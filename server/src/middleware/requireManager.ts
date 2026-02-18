import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { prisma } from '../db';

/**
 * Middleware to require MANAGER or SUPER_ADMIN role.
 * Managers get catalog/pricing/category powers.
 * SUPER_ADMIN inherits all MANAGER permissions.
 * Must be used AFTER authMiddleware.
 */
export async function requireManager(
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
            select: { id: true, name: true, role: true, status: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: User not found' });
        }

        if (user.status === 'BLOCKED') {
            return res.status(403).json({ error: 'Forbidden: Account is blocked' });
        }

        if (user.role !== 'MANAGER' && user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Forbidden: Manager access required' });
        }

        // Attach admin info for audit logging
        req.adminId = user.id;
        req.adminName = user.name || 'Manager';

        next();
    } catch (error) {
        console.error('[ManagerAuth] Error checking manager role:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
