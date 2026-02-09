import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// POST /api/callback/request
router.post('/request', async (req: Request, res: Response) => {
    try {
        const { name, mobile, city } = req.body;

        if (!name || !mobile) {
            res.status(400).json({ error: 'Name and Mobile number are required' });
            return
        }

        const callbackRequest = await prisma.callbackRequest.create({
            data: {
                name,
                mobile,
                city: city || 'Unspecified',
                status: 'PENDING'
            }
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
