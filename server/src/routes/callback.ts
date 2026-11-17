import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { rateLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// Open to everyone, so the shape is checked and each visitor is limited to stop spam requests.
const callbackSchema = z.object({
    name: z.string().trim().min(2, 'Please enter your name').max(80),
    mobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'Please enter a valid 10-digit mobile number'),
    city: z.string().trim().max(60).optional(),
});

// POST /api/callback/request
router.post('/request', rateLimiter(5, 60 * 60, 'callback_request'), async (req: Request, res: Response) => {
    try {
        const parse = callbackSchema.safeParse(req.body ?? {});
        if (!parse.success) {
            res.status(400).json({ error: parse.error.issues[0].message });
            return;
        }
        const { name, mobile, city } = parse.data;

        const callbackRequest = await prisma.callbackRequest.create({
            data: { name, mobile, city: city || 'Unspecified', status: 'PENDING' },
            select: { id: true, status: true, createdAt: true },
        });

        // TODO: Send WhatsApp notification to Admin here

        res.status(201).json({
            message: 'Callback request received successfully',
            data: callbackRequest
        });

    } catch (error) {
        console.error('Error creating callback request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
