"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = requireSuperAdmin;
const db_1 = require("../db");
/**
 * Middleware to require SUPER_ADMIN role for protected admin routes.
 * Must be used AFTER authMiddleware.
 */
async function requireSuperAdmin(req, res, next) {
    try {
        if (!req.userId) {
            return res.status(401).json({ error: 'Unauthorized: No user ID' });
        }
        const user = await db_1.prisma.user.findUnique({
            where: { id: req.userId },
            select: { id: true, name: true, role: true, status: true }
        });
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: User not found' });
        }
        if (user.status === 'BLOCKED') {
            return res.status(403).json({ error: 'Forbidden: Account is blocked' });
        }
        if (user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Forbidden: Super Admin access required' });
        }
        // Attach admin info for audit logging
        req.adminId = user.id;
        req.adminName = user.name || 'Admin';
        next();
    }
    catch (error) {
        console.error('[AdminAuth] Error checking admin role:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
