import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

export async function listCallbacks(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = req.query.search as string;
        const status = req.query.status as string;
        const createdDate = req.query.createdDate as string;

        const where: any = {};

        if (status && status !== 'All') {
            where.status = status;
        }

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { mobile: { contains: search } },
                { city: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (createdDate) {
            const start = new Date(`${createdDate}T00:00:00.000Z`);
            const end = new Date(start);
            end.setUTCDate(end.getUTCDate() + 1);
            where.createdAt = { gte: start, lt: end };
        }

        const callbacks = await prisma.callbackRequest.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
        });

        const total = await prisma.callbackRequest.count({ where });

        res.json({
            callbacks,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Admin/Manager] Error fetching callbacks:', error);
        res.status(500).json({ error: 'Failed to fetch callback requests' });
    }
}

export async function updateCallbackStatus(req: AuthRequest, res: Response) {
    try {
        const id = req.params.id as string;
        const { status, notes } = req.body;

        if (!status || !['PENDING', 'RESOLVED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be PENDING or RESOLVED' });
        }

        const callback = await prisma.callbackRequest.findUnique({ where: { id } });
        if (!callback) {
            return res.status(404).json({ error: 'Callback request not found' });
        }

        const updated = await prisma.callbackRequest.update({
            where: { id },
            data: { status, notes: notes !== undefined ? notes : callback.notes }
        });

        res.json({ success: true, callback: updated });
    } catch (error) {
        console.error('[Admin/Manager] Error updating callback:', error);
        res.status(500).json({ error: 'Failed to update callback request' });
    }
}
