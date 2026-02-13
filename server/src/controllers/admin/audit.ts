import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

/**
 * GET /api/admin/audit-logs — View audit logs (paginated)
 */
export async function getAuditLogs(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = req.query.search as string;
        const action = req.query.action as string;

        const where: any = {};

        if (action && action !== 'All') {
            where.action = action;
        }

        if (search) {
            where.OR = [
                { adminName: { contains: search, mode: 'insensitive' } },
                { entity: { contains: search, mode: 'insensitive' } },
                { targetId: { contains: search, mode: 'insensitive' } }
            ];
        }

        const logs = await prisma.adminAuditLog.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' }
        });

        const total = await prisma.adminAuditLog.count({ where });

        res.json({
            logs,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Admin] Error fetching audit logs:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
}
