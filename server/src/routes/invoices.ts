import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';
import { generateInvoicePdfForBooking } from '../services/invoiceService';
import { verifyInvoiceAccessToken } from '../services/invoiceAccess';

const router = Router();

router.get('/public/:token', async (req: AuthRequest, res: Response) => {
    try {
        const token = req.params.token as string;
        const payload = verifyInvoiceAccessToken(token);

        const booking = await prisma.booking.findUnique({
            where: { id: payload.bookingId },
            select: {
                id: true,
                paymentStatus: true,
            },
        });

        if (!booking) {
            return res.status(404).json({ error: 'We could not find this invoice.' });
        }

        if (booking.paymentStatus !== 'CONFIRMED') {
            return res.status(400).json({ error: 'Invoice is available only after the booking is confirmed.' });
        }

        const { pdf, filename } = await generateInvoicePdfForBooking(payload.bookingId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdf.length.toString());
        return res.send(pdf);
    } catch (error: any) {
        const message = error.message || 'We could not open this invoice link.';
        const status = message.includes('expired') || message.includes('Invalid invoice token') ? 400 : 500;
        if (status === 500) {
            console.error('[Invoices] Error opening public invoice link:', error);
        }
        return res.status(status).json({ error: message });
    }
});

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
