/**
 * Healthians Webhook Service
 *
 * Business logic for processing Healthians webhook events:
 * - status_updated: Update booking status + per-item delivery_status
 *     - BS003: Cancel flow (log remark, update status)
 *     - BS0013: Reschedule flow (update slot info from ref_booking)
 *     - BS0018/BS018: Resample (lab rejection — needs slot reassignment)
 * - report_uploaded: Upsert report with dedup (S3 URLs expire in 1 hour)
 * - phlebo_assigned / phlebo_reassigned: Update phlebo tracking fields
 *
 * Sources: healthians_webhook_doc.md, healthians_api_doc.md (B2B API)
 */
import { Prisma } from '@prisma/client';
import { resolveHealthiansStatus } from '../utils/healthiansStatusMap';

// Types matching Healthians webhook doc payloads
interface ProductDetail {
    deal_id: string;
    test_name: string;
    delivery_status: string;
    testDetails?: Array<{
        deal_id: string;
        test_name: string;
        delivery_status: string;
    }>;
}

interface StatusUpdateData {
    payment_status: boolean;
    paid_amount: string;
    payment_link: string;
    booking_status: string;
    sample_collection_date: string;
    start_time: string;
    end_time: string;
    vendor_customer_id: string;
    customer_status: string;
    remark: string;
    ref_booking_id: string;
    ref_booking_status: string;
    ref_booking_sample_collection_date: string;
    ref_booking_start_time: string;
    ref_booking_end_time: string;
    booking_sample_status?: {
        bookingDetail?: {
            customer?: {
                customer_name: string;
                customer_gender: string;
                product_details: ProductDetail[];
            };
        };
    };
}

interface ReportUploadedData {
    verified_at: string;
    report_url: string;
    full_report: number;
    vendor_customer_id: string;
}

interface PhleboData {
    phlebo_name: string;
    start_time: string;
    end_time: string;
    sample_collection_date: string;
    message: string;
    url: string;
    masked_number: string;
}

type PrismaTransactionClient = Prisma.TransactionClient;

/**
 * Handle status_updated webhook event.
 * Updates booking status, partnerStatus, and per-item delivery_status.
 */
export async function handleStatusUpdate(
    tx: PrismaTransactionClient,
    booking: { id: string; items: Array<{ id: string; testCode: string }> },
    data: StatusUpdateData
): Promise<void> {
    const statusInfo = resolveHealthiansStatus(data.booking_status);

    console.log(
        `[HealthiansWebhook] status_updated: booking=${booking.id} ` +
        `BS=${data.booking_status} → ${statusInfo.docnowStatus} ` +
        `(action=${statusInfo.action})`
    );

    // Update booking-level status
    await tx.booking.update({
        where: { id: booking.id },
        data: {
            partnerStatus: data.booking_status,
            status: statusInfo.docnowStatus,
        },
    });

    // Handle reschedule: link ref_booking_id if present
    if (
        statusInfo.action === 'reschedule' &&
        data.ref_booking_id &&
        data.ref_booking_id !== '0'
    ) {
        console.log(
            `[HealthiansWebhook] Reschedule detected. ` +
            `Old booking ref: ${data.ref_booking_id}, ` +
            `new slot: ${data.sample_collection_date} ${data.start_time}-${data.end_time}`
        );
        // Update slot info from the reschedule payload
        await tx.booking.update({
            where: { id: booking.id },
            data: {
                slotDate: data.sample_collection_date,
                slotTime: `${data.start_time} - ${data.end_time}`,
                rescheduledToId: data.ref_booking_id,
            },
        });
    }

    // Handle resample (BS0018/BS018): Lab rejected the sample.
    // Per B2B API doc (setSlotForBooking): a new ref_booking_id is generated
    // and the partner must call setSlotForBooking to assign a new slot.
    if (
        statusInfo.action === 'resample' &&
        data.ref_booking_id &&
        data.ref_booking_id !== '0'
    ) {
        console.warn(
            `[HealthiansWebhook] RESAMPLE required for booking=${booking.id}. ` +
            `Lab rejection — new ref_booking_id=${data.ref_booking_id}. ` +
            `Action: call setSlotForBooking API with the new booking ID.`
        );
        // Store the resample reference for manual/automated follow-up
        await tx.booking.update({
            where: { id: booking.id },
            data: {
                rescheduledToId: data.ref_booking_id,
            },
        });
    }

    // Handle cancel (BS003): Log the cancellation remark from Healthians
    if (statusInfo.action === 'cancel' && data.remark) {
        console.log(
            `[HealthiansWebhook] Cancellation remark for booking=${booking.id}: ${data.remark}`
        );
        await tx.booking.update({
            where: { id: booking.id },
            data: {
                partnerError: data.remark,
            },
        });
    }

    // Update per-item delivery_status from nested product_details
    const productDetails =
        data.booking_sample_status?.bookingDetail?.customer?.product_details;

    if (productDetails?.length && booking.items.length) {
        await updateBookingItemStatuses(tx, booking.items, productDetails);
    }
}

/**
 * Update BookingItem.status from Healthians product_details.
 * Matches deal_id → testCode at package/test level.
 * Parameter-level testDetails are logged but not persisted.
 */
async function updateBookingItemStatuses(
    tx: PrismaTransactionClient,
    items: Array<{ id: string; testCode: string }>,
    productDetails: ProductDetail[]
): Promise<void> {
    for (const product of productDetails) {
        const item = items.find((i) => i.testCode === product.deal_id);
        if (item) {
            await tx.bookingItem.update({
                where: { id: item.id },
                data: { status: product.delivery_status },
            });
        }

        // Log parameter-level divergence (not persisted)
        if (product.testDetails?.length) {
            for (const param of product.testDetails) {
                if (param.delivery_status !== product.delivery_status) {
                    console.log(
                        `[HealthiansWebhook] Parameter ${param.deal_id} (${param.test_name}) ` +
                        `status ${param.delivery_status} diverges from package ` +
                        `${product.deal_id} status ${product.delivery_status}`
                    );
                }
            }
        }
    }
}

/**
 * Handle report_uploaded webhook event.
 * Upserts a Report record with dedup on (bookingId, vendorCustomerId, isFullReport, verifiedAt).
 *
 * IMPORTANT — Ingestion guard:
 * - If a matching report already exists and is STORED, do NOT reset to PENDING
 *   unless the sourceUrl has meaningfully changed (i.e. a new/corrected report).
 * - Returns the report ID so the caller can trigger background ingestion.
 *
 * S3 URL Expiry:
 * The report_url is a signed S3 URL (X-Amz-Expires=3600 = 1 hour).
 * Ingestion should download the PDF immediately after this transaction.
 * Fallback: call getCustomerReport_v2 API for a fresh signed URL.
 */
export async function handleReportUploaded(
    tx: PrismaTransactionClient,
    booking: { id: string; items?: Array<{ patientId: string }> },
    data: ReportUploadedData
): Promise<string> {
    const sourceUrl = data.report_url?.trim() || '';
    let vendorCustomerId = data.vendor_customer_id?.trim() || '';
    
    // Fallback: If Healthians forgot to send vendor_customer_id but the booking 
    // only has tests for ONE specific patient, we can safely infer it.
    if (!vendorCustomerId && booking.items && booking.items.length > 0) {
        const uniquePatientIds = [...new Set(booking.items.map(i => i.patientId))];
        if (uniquePatientIds.length === 1) {
            vendorCustomerId = uniquePatientIds[0] as string;
            console.log(`[HealthiansWebhook] Inferred missing vendor_customer_id as ${vendorCustomerId}`);
        } else {
            console.warn(`[HealthiansWebhook] WARNING: Missing vendor_customer_id in report_uploaded, and booking ${booking.id} has multiple patients. Saving with blank ID.`);
        }
    }

    const isFullReport = data.full_report === 1;
    const verifiedAt = data.verified_at ? new Date(data.verified_at) : null;

    console.log(
        `[HealthiansWebhook] report_uploaded: booking=${booking.id} ` +
        `vendorCustomer=${vendorCustomerId || '(none)'} ` +
        `fullReport=${isFullReport} verifiedAt=${data.verified_at} ` +
        `(S3 URL expires in ~1 hour)`
    );

    // Check if report already exists with this identity
    const existing = await tx.report.findUnique({
        where: {
            bookingId_vendorCustomerId_isFullReport_verifiedAt: {
                bookingId: booking.id,
                vendorCustomerId,
                isFullReport,
                verifiedAt: verifiedAt as Date,
            },
        },
    });

    if (existing) {
        // Guard: don't reset STORED reports unless sourceUrl changed
        if (existing.fetchStatus === 'STORED' && existing.sourceUrl === sourceUrl) {
            console.log(
                `[HealthiansWebhook] Report ${existing.id} already STORED with same URL. Skipping.`
            );
            return existing.id;
        }

        // Update with fresh sourceUrl, re-trigger ingestion only if needed
        const report = await tx.report.update({
            where: { id: existing.id },
            data: {
                sourceUrl,
                ...(existing.fetchStatus !== 'STORED' && { fetchStatus: 'PENDING', fetchError: null }),
            },
        });
        return report.id;
    }

    // Create new report row
    const report = await tx.report.create({
        data: {
            bookingId: booking.id,
            vendorCustomerId,
            sourceUrl,
            isFullReport,
            verifiedAt,
            fetchStatus: 'PENDING',
        },
    });

    return report.id;
}

/**
 * Handle phlebo_assigned and phlebo_reassigned webhook events.
 * Updates phlebo tracking fields on the booking.
 */
export async function handlePhleboEvent(
    tx: PrismaTransactionClient,
    booking: { id: string },
    data: PhleboData
): Promise<void> {
    console.log(
        `[HealthiansWebhook] phlebo event: booking=${booking.id} ` +
        `phlebo=${data.phlebo_name} phone=${data.masked_number}`
    );

    await tx.booking.update({
        where: { id: booking.id },
        data: {
            phleboName: data.phlebo_name,
            phleboPhone: data.masked_number,
            phleboTrackingUrl: data.url || null,
            // Also update slot info from phlebo assignment
            slotDate: data.sample_collection_date || undefined,
            slotTime: data.start_time && data.end_time
                ? `${data.start_time} - ${data.end_time}`
                : undefined,
        },
    });
}
