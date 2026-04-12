import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';
import { generateInvoicePdfForBooking } from '../services/invoiceService';

const router = Router();

router.use(authMiddleware);

router.get('/booking/:bookingId/download', async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.bookingId as string;
        const userId = req.userId!;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
        });

        const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

        const booking = await prisma.booking.findFirst({
            where: isAdmin ? { id: bookingId } : { id: bookingId, userId },
            select: {
                id: true,
                paymentStatus: true,
            },
        });

        if (!booking) {
            return res.status(404).json({ error: 'We could not find this booking.' });
        }

        if (booking.paymentStatus !== 'CONFIRMED') {
            return res.status(400).json({ error: 'Invoice is available only after the booking is confirmed.' });
        }

        const { pdf, filename } = await generateInvoicePdfForBooking(bookingId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdf.length.toString());
        return res.send(pdf);
    } catch (error) {
        console.error('[Invoices] Error downloading invoice:', error);
        return res.status(500).json({ error: 'We could not generate your invoice right now. Please try again shortly.' });
    }
});

export default router;
