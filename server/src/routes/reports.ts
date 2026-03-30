/**
 * Report Routes
 *
 * Customer and admin report access API.
 * Files are streamed through the API — local storage is never exposed directly.
 *
 * Endpoints:
 *   GET /api/reports/booking/:bookingId    — list reports for a booking (auth required)
 *   GET /api/reports/:reportId/download    — stream the report PDF (auth required)
 */
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';
import { reportStorage } from '../services/reportStorage';
import { ingestReport } from '../services/reportIngestion';

const router = Router();

// All report routes require authentication
router.use(authMiddleware);

/**
 * GET /api/reports/booking/:bookingId
 * List all reports for a booking. User must own the booking or be admin/manager.
 */
router.get('/booking/:bookingId', async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId!;
        const bookingId = req.params.bookingId as string;

        // Look up user role for admin access
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
        });

        const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

        // Verify user owns this booking or is admin
        const booking = await prisma.booking.findFirst({
            where: isAdmin ? { id: bookingId } : { id: bookingId, userId },
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const reports = await prisma.report.findMany({
            where: { bookingId },
            select: {
                id: true,
                isFullReport: true,
                fetchStatus: true,
                verifiedAt: true,
                fileSize: true,
                generatedAt: true,
                vendorCustomerId: true,
            },
            orderBy: { generatedAt: 'desc' },
        });

        return res.json({ reports });
    } catch (error) {
        console.error('[Reports] Error listing reports:', error);
        return res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

/**
 * GET /api/reports/:reportId/download
 * Stream the report PDF to the client.
 *
 * Priority:
 * 1. If storageKey exists → stream from our storage
 * 2. If fetchStatus is PENDING/FAILED → attempt on-demand ingestion, then stream
 * 3. Last resort → redirect to sourceUrl (may be expired)
 */
router.get('/:reportId/download', async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId!;
        const reportId = req.params.reportId as string;

        const report = await prisma.report.findUnique({
            where: { id: reportId },
            include: {
                booking: {
                    select: { userId: true },
                },
            },
        });

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        // Auth check: user must own the booking, OR be admin/manager
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
        });

        const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

        // we can safely cast here to bypass TS issue if Prisma types are weird
        const reportUserId = (report as any).booking.userId;

        if (!isAdmin && reportUserId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Path 1: File is in our storage → stream it
        if (report.storageKey) {
            try {
                const exists = await reportStorage.exists(report.storageKey);
                if (exists) {
                    const buffer = await reportStorage.read(report.storageKey);
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', `inline; filename="report-${reportId}.pdf"`);
                    res.setHeader('Content-Length', buffer.length.toString());
                    return res.send(buffer);
                }
            } catch (err) {
                console.warn(`[Reports] Storage read failed for key ${report.storageKey}:`, err);
            }
        }

        // Path 2: Status is PENDING or FAILED → try on-demand ingestion
        if (report.fetchStatus !== 'STORED') {
            try {
                await ingestReport(reportId);
                // Re-read after ingestion
                const updated = await prisma.report.findUnique({ where: { id: reportId } });
                if (updated?.storageKey) {
                    const buffer = await reportStorage.read(updated.storageKey);
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', `inline; filename="report-${reportId}.pdf"`);
                    res.setHeader('Content-Length', buffer.length.toString());
                    return res.send(buffer);
                }
            } catch (err) {
                console.warn(`[Reports] On-demand ingestion failed for ${reportId}:`, err);
            }
        }

        // Path 3: Last resort — redirect to sourceUrl (may be expired)
        console.warn(`[Reports] Falling back to sourceUrl for report ${reportId} (may be expired)`);
        return res.redirect(report.sourceUrl);
    } catch (error) {
        console.error('[Reports] Error downloading report:', error);
        return res.status(500).json({ error: 'Failed to download report' });
    }
});

export default router;
