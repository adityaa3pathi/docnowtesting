import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getClientIP } from '../../utils/adminHelpers';

/**
 * GET /api/admin/config — Get all configs
 */
export async function getConfigs(req: AuthRequest, res: Response) {
    try {
        const configs = await prisma.systemConfig.findMany();
        res.json({ configs });
    } catch (error) {
        console.error('[Admin] Error fetching configs:', error);
        res.status(500).json({ error: 'Failed to fetch configs' });
    }
}

/**
 * PUT /api/admin/config/:key — Update config
 */
export async function updateConfig(req: AuthRequest, res: Response) {
    try {
        const configKey = req.params.key as string;
        const { value, reason } = req.body;

        if (!value) {
            return res.status(400).json({ error: 'Value is required' });
        }

        const existing = await prisma.systemConfig.findUnique({ where: { key: configKey } });
        const oldValue = existing?.value;
        const clientIP = getClientIP(req);

        const config = await prisma.systemConfig.upsert({
            where: { key: configKey },
            update: { value, updatedBy: req.adminId },
            create: { key: configKey, value, updatedBy: req.adminId }
        });

        await prisma.adminAuditLog.create({
            data: {
                adminId: req.adminId!,
                adminName: req.adminName || 'Admin',
                action: 'CONFIG_UPDATED',
                entity: 'SystemConfig',
                targetId: configKey,
                oldValue: oldValue ? { value: oldValue } : undefined,
                newValue: { value, reason: reason || '' },
                ipAddress: clientIP
            }
        });

        res.json({ success: true, config });
    } catch (error) {
        console.error('[Admin] Error updating config:', error);
        res.status(500).json({ error: 'Failed to update config' });
    }
}
