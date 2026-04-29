/**
 * Report Ingestion Service
 *
 * Downloads report PDFs from Healthians' signed S3 URLs and stores them
 * permanently in our own object storage. Called after webhook transaction commits.
 *
 * Flow:
 * 1. Read Report row (fetchStatus = PENDING)
 * 2. Download PDF from sourceUrl
 * 3. Upload to our storage via reportStorage
 * 4. Update Report with storageKey, fetchStatus: STORED
 * 5. On failure: set fetchStatus: FAILED, attempt fallback via getCustomerReport_v2
 */
import axios from 'axios';
import { prisma } from '../db';
import { originalReportStorageKey, reportStorage, reportStorageKey } from './reportStorage';
import { HealthiansAdapter } from '../adapters/healthians';
import { sendReportReadyViaWhatsApp } from './reportNotifications';
import { brandReportPdf } from './reportBrandingService';
import { logAlert, logBusinessEvent, logger } from '../utils/logger';

interface IngestReportOptions {
    forceRefresh?: boolean;
}

/**
 * Ingest a single report by ID.
 * Call this AFTER the webhook transaction commits.
 */
export async function ingestReport(reportId: string, options: IngestReportOptions = {}): Promise<void> {
    const report = await prisma.report.findUnique({
        where: { id: reportId },
        include: {
            booking: {
                select: {
                    id: true,
                    partnerBookingId: true,
                    rescheduledToId: true,
                    userId: true,
                    user: {
                        select: {
                            name: true,
                            mobile: true,
                        },
                    },
                    items: {
                        select: {
                            testName: true,
                        },
                    },
                },
            },
        },
    });

    if (!report) {
        logger.warn({ reportId }, 'report_ingestion_report_not_found');
        return;
    }

    // Skip only when we are sure the stored file still exists and no force refresh was requested.
    if (!options.forceRefresh && report.fetchStatus === 'STORED' && report.storageKey) {
        const exists = await reportStorage.exists(report.storageKey).catch(() => false);
        if (exists) {
            logBusinessEvent('report_ingestion_already_stored', { reportId, bookingId: report.bookingId }, 'debug');
            return;
        }
        logger.warn({ reportId, bookingId: report.bookingId }, 'report_ingestion_storage_key_missing');
    }

    if (options.forceRefresh) {
        logBusinessEvent('report_ingestion_force_refresh_requested', { reportId, bookingId: report.bookingId });
    }

    // If we were force-refreshing a stale STORED record, clear the stale state before retrying.
    if (options.forceRefresh && report.fetchStatus === 'STORED') {
        await prisma.report.update({
            where: { id: reportId },
            data: {
                fetchStatus: 'PENDING',
                fetchError: null,
                storageKey: null,
                fetchedAt: null,
                fileSize: null,
            },
        });
    }

    logBusinessEvent('report_ingestion_started', {
        reportId,
        bookingId: report.bookingId,
        isFullReport: report.isFullReport,
        forceRefresh: Boolean(options.forceRefresh),
    });

    // Attempt 1: Download from the original sourceUrl
    let pdfBuffer = await downloadPdf(report.sourceUrl);

    // Attempt 2: If download failed (likely expired URL), try getCustomerReport_v2
    const activePartnerBookingId = report.booking?.rescheduledToId || report.booking?.partnerBookingId;

    if (!pdfBuffer && activePartnerBookingId) {
        logger.warn({ reportId, bookingId: report.bookingId }, 'report_source_download_failed_trying_fallback');
        try {
            const adapter = HealthiansAdapter.getInstance();
            const freshReport = await adapter.getCustomerReport({
                booking_id: activePartnerBookingId,
                vendor_billing_user_id: report.booking.userId,
                vendor_customer_id: report.vendorCustomerId || '',
                allow_partial_report: report.isFullReport ? 0 : 1,
            });

            if (freshReport?.data?.report_url) {
                const freshUrl = freshReport.data.report_url.trim();

                // Update sourceUrl with the fresh one
                await prisma.report.update({
                    where: { id: reportId },
                    data: { sourceUrl: freshUrl },
                });

                pdfBuffer = await downloadPdf(freshUrl);
            }
        } catch (err: any) {
            logger.warn({ error: err, reportId, bookingId: report.bookingId }, 'report_fallback_url_fetch_failed');
        }
    }

    if (!pdfBuffer) {
        // Both attempts failed
        await prisma.report.update({
            where: { id: reportId },
            data: {
                fetchStatus: 'FAILED',
                fetchError: 'Failed to download PDF from sourceUrl and getCustomerReport_v2 fallback.',
            },
        });
        logAlert('report_ingestion_failed', { reportId, bookingId: report.bookingId });
        return;
    }

    // Upload to our storage
    try {
        const key = reportStorageKey(report.bookingId, report.id);
        const originalKey = originalReportStorageKey(report.bookingId, report.id);
        const shouldNotifyCustomer = !options.forceRefresh && report.fetchStatus !== 'STORED' && report.isFullReport;
        let customerPdfBuffer = pdfBuffer;

        try {
            customerPdfBuffer = await brandReportPdf(pdfBuffer);
        } catch (brandingError: any) {
            logger.warn({ error: brandingError, reportId, bookingId: report.bookingId }, 'report_branding_failed_using_original');
        }

        await reportStorage.upload(originalKey, pdfBuffer, 'application/pdf');
        await reportStorage.upload(key, customerPdfBuffer, 'application/pdf');

        await prisma.report.update({
            where: { id: reportId },
            data: {
                storageKey: key,
                fetchStatus: 'STORED',
                fetchError: null,
                fetchedAt: new Date(),
                fileSize: customerPdfBuffer.length,
            },
        });

        logBusinessEvent('report_stored', {
            reportId,
            bookingId: report.bookingId,
            fileSize: customerPdfBuffer.length,
        });

        if (shouldNotifyCustomer && report.booking?.user?.mobile) {
            const itemNames = report.booking.items.map((item) => item.testName).filter(Boolean);
            const reportLabel =
                itemNames.length === 0
                    ? `Booking ${report.booking.id.slice(0, 8)} report`
                    : itemNames.length === 1
                        ? itemNames[0]
                        : `${itemNames[0]} + ${itemNames.length - 1} more test${itemNames.length - 1 > 1 ? 's' : ''}`;

            try {
                const notification = await sendReportReadyViaWhatsApp({
                    mobile: report.booking.user.mobile,
                    customerName: report.booking.user.name,
                    reportLabel,
                });
                logBusinessEvent('report_notification_sent', {
                    reportId,
                    bookingId: report.bookingId,
                    notificationId: notification.id,
                    notificationStatus: notification.status,
                });
            } catch (notifyErr: any) {
                logAlert('report_notification_failed', { error: notifyErr, reportId, bookingId: report.bookingId });
            }
        }
    } catch (err: any) {
        await prisma.report.update({
            where: { id: reportId },
            data: {
                fetchStatus: 'FAILED',
                fetchError: `Storage upload failed: ${err.message}`,
            },
        });
        logAlert('report_storage_upload_failed', { error: err, reportId, bookingId: report.bookingId });
    }
}

/**
 * Download a PDF from a URL. Returns null if download fails.
 */
async function downloadPdf(url: string): Promise<Buffer | null> {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000, // 30 second timeout
            headers: {
                'User-Agent': 'DOCNOW-Server/1.0',
            },
        });

        if (response.status === 200 && response.data) {
            return Buffer.from(response.data);
        }

        logger.warn({ statusCode: response.status }, 'report_download_unexpected_status');
        return null;
    } catch (err: any) {
        logger.warn({ error: err }, 'report_download_failed');
        return null;
    }
}
