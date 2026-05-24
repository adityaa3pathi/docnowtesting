/**
 * Healthians Booking Status Code Mapping
 *
 * Maps Healthians BS codes to DocNow-facing statuses.
 * Sources:
 *   - healthians_webhook_doc.md (webhook payload samples)
 *   - healthians_api_doc.md (B2B API doc — cancelBooking, getBookingStatus, setSlotForBooking)
 *
 * Unknown codes are handled gracefully with a fallback.
 */

export interface HealthiansStatusInfo {
    docnowStatus: string;
    isFinal: boolean;
    action: 'update' | 'cancel' | 'reschedule' | 'resample' | 'none';
    source: string; // Documentation source for traceability
}

/**
 * Complete BS code mapping from both the webhook doc and B2B API doc.
 *
 * [WEBHOOK]  = Confirmed from healthians_webhook_doc.md payload samples
 * [B2B-API]  = Confirmed from healthians_api_doc.md (cancelBooking, getBookingStatus, setSlotForBooking)
 */
export const HEALTHIANS_STATUS_MAP: Record<string, HealthiansStatusInfo> = {
    // ── Booking Lifecycle ─────────────────────────────────────────────────
    'BS002': {
        docnowStatus: 'Order Booked',
        isFinal: false,
        action: 'update',
        source: '[B2B-API] cancelBooking: "Order Booked (BS002)" — cancellable state',
    },
    'BS005': {
        docnowStatus: 'Sample Collector Assigned',
        isFinal: false,
        action: 'update',
        source: '[B2B-API] cancelBooking: "Sample Collector Assigned (BS005)" — cancellable state',
    },
    'BS007': {
        docnowStatus: 'Sample Collected',
        isFinal: false,
        action: 'update',
        source: '[B2B-API] getBookingStatus response shows BS007 for active customer/test statuses',
    },
    'BS008': {
        docnowStatus: 'Sample Received at Lab',
        isFinal: false,
        action: 'update',
        source: '[WEBHOOK] "booking goes to sample received at merchant" — booking_status BS008',
    },

    // ── Terminal / Branching States ────────────────────────────────────────
    'BS003': {
        docnowStatus: 'Cancelled',
        isFinal: true,
        action: 'cancel',
        source: '[WEBHOOK] "booking goes cancel" — remark: CUSTOMER_CANCELLED. [B2B-API] getBookingStatus confirms BS003 for cancelled customers.',
    },
    'BS0013': {
        docnowStatus: 'Rescheduled',
        isFinal: false,
        action: 'reschedule',
        source: '[WEBHOOK] "booking goes to reschedule" — ref_booking_id contains new booking. booking_status BS0013.',
    },

    // ── Lab Rejection / Resample ──────────────────────────────────────────
    'BS0018': {
        docnowStatus: 'Resample Required',
        isFinal: false,
        action: 'resample',
        source: '[B2B-API] setSlotForBooking: "rejected booking will contain ref_booking_id... status should be BS0018"',
    },
    'BS018': {
        // Variant without leading zero — map identically
        docnowStatus: 'Resample Required',
        isFinal: false,
        action: 'resample',
        source: '[B2B-API] setSlotForBooking webhook reference: "BS018" (variant of BS0018)',
    },
};

/**
 * Resolve a Healthians BS code to a DocNow status.
 * Unknown codes are logged and stored with a human-readable fallback.
 */
export function resolveHealthiansStatus(bsCode: string): HealthiansStatusInfo {
    const mapped = HEALTHIANS_STATUS_MAP[bsCode];
    if (mapped) return mapped;

    console.warn(`[HealthiansWebhook] Unknown BS code: ${bsCode}. Falling back to a generic customer-facing status.`);
    return {
        docnowStatus: 'Processing Update Received',
        isFinal: false,
        action: 'update',
        source: 'UNKNOWN — not in webhook or B2B API documentation',
    };
}

/**
 * Customer-facing cancellation denial reasons by BS code.
 * Maps raw partner status codes to professional, human-readable messages
 * so end users never see internal codes like "BS0026".
 */
const CANCEL_DENIAL_MESSAGES: Record<string, string> = {
    'BS007':  'Your sample has already been collected. Cancellation is no longer available.',
    'BS008':  'Your sample has been received at the lab. Cancellation is no longer available.',
    'BS003':  'This booking has already been cancelled.',
    'BS0013': 'This booking has been rescheduled. Please manage the new booking instead.',
    'BS0018': 'A resample has been requested for this booking. Please contact support for assistance.',
    'BS018':  'A resample has been requested for this booking. Please contact support for assistance.',
    'BS015':  'Your reports are being processed. Cancellation is no longer available.',
};

/**
 * Get a professional, user-facing message explaining why a booking cannot be cancelled.
 * Internal BS codes are never exposed to end users.
 */
export function getCancelDenialMessage(bsCode: string | null | undefined): string {
    if (!bsCode) return 'This booking cannot be cancelled at this time. Please contact support for assistance.';

    const friendly = CANCEL_DENIAL_MESSAGES[bsCode];
    if (friendly) return friendly;

    // For any unmapped code, log it but show a generic professional message
    const mapped = HEALTHIANS_STATUS_MAP[bsCode];
    if (mapped) {
        return `This booking is currently in "${mapped.docnowStatus}" status and cannot be cancelled. Please contact support for assistance.`;
    }

    console.warn(`[StatusMap] No cancel-denial message for BS code: ${bsCode}`);
    return 'This booking cannot be cancelled at this time. Please contact support for assistance.';
}

