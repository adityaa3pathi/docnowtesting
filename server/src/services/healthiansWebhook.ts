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
 * Upserts a Report record with dedup on (bookingId, reportUrl).
 *
 * IMPORTANT — S3 URL Expiry:
 * The report_url is a signed S3 URL (X-Amz-Expires=3600 = 1 hour).
 * Confirmed from B2B API doc: getCustomerReport_v2 response shows
 * "https://s3healthians...?X-Amz-Expires=3600"
 *
 * Current strategy: Store URL immediately, serve to user within 1 hour.
 * Fallback: If URL expires, call getCustomerReport_v2 API to get a fresh signed URL.
 * Future: Add background job to fetch PDF and re-upload to our own storage.
 */
export async function handleReportUploaded(
    tx: PrismaTransactionClient,
    booking: { id: string },
    data: ReportUploadedData
): Promise<void> {
    const verifiedAt = data.verified_at ? new Date(data.verified_at) : null;
    const isFullReport = data.full_report === 1;

    console.log(
        `[HealthiansWebhook] report_uploaded: booking=${booking.id} ` +
        `fullReport=${isFullReport} verifiedAt=${data.verified_at} ` +
        `(S3 URL expires in ~1 hour)`
    );

    // Upsert with composite unique (bookingId, reportUrl)
    await tx.report.upsert({
        where: {
            bookingId_reportUrl: {
                bookingId: booking.id,
                reportUrl: data.report_url,
            },
        },
        create: {
            bookingId: booking.id,
            reportUrl: data.report_url,
            isFullReport,
            verifiedAt,
        },
        update: {
            isFullReport,
            verifiedAt,
        },
    });
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
