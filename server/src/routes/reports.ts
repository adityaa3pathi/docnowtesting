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
import { originalReportStorageKey, reportStorage } from '../services/reportStorage';
import { ingestReport } from '../services/reportIngestion';
import axios from 'axios';
import { brandReportPdf } from '../services/reportBrandingService';
import { verifyReportAccessToken } from '../services/reportAccess';

const router = Router();

function sendPdfBuffer(res: Response, reportId: string, buffer: Buffer) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${reportId}.pdf"`);
    res.setHeader('Content-Length', buffer.length.toString());
    return res.send(buffer);
}

async function streamReportPdf(reportId: string, res: Response) {
    const report = await prisma.report.findUnique({
        where: { id: reportId },
        include: {
            booking: {
                select: { userId: true },
            },
        },
    });

    if (!report) {
        return res.status(404).json({ error: 'This report is not available anymore.' });
    }

    let legacyStoredBuffer: Buffer | null = null;
    let shouldForceRefresh = false;

    if (report.storageKey) {
        try {
            const exists = await reportStorage.exists(report.storageKey);
            if (exists) {
                const buffer = await reportStorage.read(report.storageKey);
                const originalKey = originalReportStorageKey(report.bookingId, reportId);
                const originalExists = await reportStorage.exists(originalKey).catch(() => false);

                if (originalExists) {
                    return sendPdfBuffer(res, reportId, buffer);
                }

                legacyStoredBuffer = buffer;
                shouldForceRefresh = true;
                console.warn(`[Reports] Report ${reportId} appears to be a legacy unbranded stored PDF. Attempting refresh before serving.`);
            } else {
                shouldForceRefresh = true;
                console.warn(`[Reports] Report ${reportId} has storageKey=${report.storageKey} but the file is missing from storage. Will try force re-ingestion.`);
            }
        } catch (err) {
            console.warn(`[Reports] Storage read failed for key ${report.storageKey}:`, err);
            shouldForceRefresh = true;
        }
    }

    if (report.fetchStatus !== 'STORED' || shouldForceRefresh) {
        try {
            await ingestReport(reportId, { forceRefresh: shouldForceRefresh });
            const updated = await prisma.report.findUnique({ where: { id: reportId } });
            if (updated?.storageKey) {
                const buffer = await reportStorage.read(updated.storageKey);
                return sendPdfBuffer(res, reportId, buffer);
            }
        } catch (err) {
            console.warn(`[Reports] On-demand ingestion failed for ${reportId}:`, err);
        }
    }

    if (legacyStoredBuffer) {
        return sendPdfBuffer(res, reportId, legacyStoredBuffer);
    }

    if (report.sourceUrl) {
        console.warn(`[Reports] Falling back to proxied sourceUrl for report ${reportId}`);
        try {
            const sourceResponse = await axios.get<ArrayBuffer>(report.sourceUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'DOCNOW-Server/1.0',
                },
            });

            const originalBuffer: Buffer = Buffer.from(sourceResponse.data as ArrayBuffer);
            let brandedBuffer: Buffer = originalBuffer;

            try {
                brandedBuffer = await brandReportPdf(originalBuffer);
            } catch (brandingError: any) {
                console.warn(`[Reports] Last-resort branding failed for ${reportId}:`, brandingError.message);
            }
            return sendPdfBuffer(res, reportId, brandedBuffer);
        } catch (err) {
            console.warn(`[Reports] sourceUrl proxy failed for ${reportId}:`, err);
        }
    }

    return res.status(502).json({ error: 'Your report is still being prepared. Please try again shortly.' });
}

router.get('/public/:token', async (req: AuthRequest, res: Response) => {
    try {
        const token = req.params.token as string;
        const payload = verifyReportAccessToken(token);
        return await streamReportPdf(payload.reportId, res);
    } catch (error: any) {
        const message = error.message || 'We could not open this report link.';
        const status = message.includes('expired') || message.includes('Invalid report token') ? 400 : 500;
        if (status === 500) {
            console.error('[Reports] Error opening public report link:', error);
        }
        return res.status(status).json({ error: message });
    }
});

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
            return res.status(404).json({ error: 'We could not find this booking.' });
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
        return res.status(500).json({ error: 'We could not load your reports right now. Please try again shortly.' });
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
            return res.status(404).json({ error: 'This report is not available anymore.' });
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
            return res.status(403).json({ error: 'You do not have access to this report.' });
        }
        return await streamReportPdf(reportId, res);
    } catch (error) {
        console.error('[Reports] Error downloading report:', error);
        return res.status(500).json({ error: 'We could not download your report right now. Please try again shortly.' });
    }
});

export default router;
