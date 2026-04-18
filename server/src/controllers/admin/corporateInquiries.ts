import { Response } from 'express';
import { CorporateInquiryStatus } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

const VALID_STATUSES: CorporateInquiryStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED'];

export async function listCorporateInquiries(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = (req.query.search as string) || '';
        const status = req.query.status as CorporateInquiryStatus | 'All' | undefined;
        const city = (req.query.city as string) || '';
        const requirementType = (req.query.requirementType as string) || '';
        const companySize = (req.query.companySize as string) || '';
        const createdDate = (req.query.createdDate as string) || '';

        const where: any = {};

        if (status && status !== 'All' && VALID_STATUSES.includes(status as CorporateInquiryStatus)) {
            where.status = status;
        }
        if (city) where.city = { contains: city, mode: 'insensitive' };
        if (requirementType) where.requirementType = requirementType;
        if (companySize) where.companySize = companySize;
        if (createdDate) {
            const start = new Date(`${createdDate}T00:00:00.000Z`);
            const end = new Date(start);
            end.setUTCDate(end.getUTCDate() + 1);
            where.createdAt = { gte: start, lt: end };
        }

        if (search) {
            where.OR = [
                { contactName: { contains: search, mode: 'insensitive' } },
                { companyName: { contains: search, mode: 'insensitive' } },
                { mobile: { contains: search } },
                { workEmail: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [inquiries, total] = await Promise.all([
            prisma.corporateInquiry.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.corporateInquiry.count({ where }),
        ]);

        res.json({
            inquiries,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('[Admin/Manager] Error fetching corporate inquiries:', error);
        res.status(500).json({ error: 'Failed to fetch corporate inquiries' });
    }
}

export async function updateCorporateInquiryStatus(req: AuthRequest, res: Response) {
    try {
        const id = req.params.id as string;
        const { status, notes } = req.body as { status?: CorporateInquiryStatus; notes?: string };

        if (!status || !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be NEW, CONTACTED, QUALIFIED, or CLOSED' });
        }

        const inquiry = await prisma.corporateInquiry.findUnique({ where: { id } });
        if (!inquiry) {
            return res.status(404).json({ error: 'Corporate inquiry not found' });
        }

        const updated = await prisma.corporateInquiry.update({
            where: { id },
            data: {
                status,
                notes: notes !== undefined ? notes : inquiry.notes,
            },
        });

        res.json({ success: true, inquiry: updated });
    } catch (error) {
        console.error('[Admin/Manager] Error updating corporate inquiry:', error);
        res.status(500).json({ error: 'Failed to update corporate inquiry' });
    }
}
