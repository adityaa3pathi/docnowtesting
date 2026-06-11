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
 * Complete BS code mapping from the official Healthians documentation.
 *
 * [WEBHOOK]  = Confirmed from healthians_webhook_doc.md payload samples
 * [B2B-API]  = Confirmed from healthians_api_doc.md (cancelBooking, getBookingStatus, setSlotForBooking)
 * [OFFICIAL] = From official Healthians BS code table (2026-06)
 */
export const HEALTHIANS_STATUS_MAP: Record<string, HealthiansStatusInfo> = {
    // ── Booking Lifecycle ─────────────────────────────────────────────────
    'BS002': {
        docnowStatus: 'Order Booked',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Order Booked" — cancellable state',
    },
    'BS005': {
        docnowStatus: 'Sample Collector Assigned',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Pickup Scheduled — Booking is verified" — cancellable state',
    },
    'BS006': {
        docnowStatus: 'Sample Collector Reached',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Sample Collector Reached Home" — phlebo on site, sample not yet collected',
    },
    'BS007': {
        docnowStatus: 'Sample Collected',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Sample Collected"',
    },
    'BS008': {
        docnowStatus: 'Sample Received at Lab',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Sample Received at Lab"',
    },
    'BS009': {
        docnowStatus: 'Report Generated',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Report Generated from the Lab but pending for verification"',
    },
    'BS0012': {
        docnowStatus: 'Health Counselling Done',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Doctor Consultation Done"',
    },
    'BS015': {
        docnowStatus: 'Report Available',
        isFinal: true,
        action: 'update',
        source: '[OFFICIAL] "Report is available and send to customer"',
    },
    'BS0015': {
        // Variant with leading zero — Healthians actually sends this format
        docnowStatus: 'Report Available',
        isFinal: true,
        action: 'update',
        source: '[OFFICIAL] "Report is available and send to customer" (variant of BS015)',
    },

    // ── Terminal / Branching States ────────────────────────────────────────
    'BS003': {
        docnowStatus: 'Cancelled',
        isFinal: true,
        action: 'cancel',
        source: '[OFFICIAL] "Order Cancelled"',
    },
    'BS0013': {
        docnowStatus: 'Rescheduled',
        isFinal: false,
        action: 'reschedule',
        source: '[OFFICIAL] "Booking Reschedule" — ref_booking_id contains new booking',
    },

    // ── Lab Rejection / Resample ──────────────────────────────────────────
    'BS0018': {
        docnowStatus: 'Resample Required',
        isFinal: false,
        action: 'resample',
        source: '[OFFICIAL] "Resampling Process Initiated" — ref_booking_id provided',
    },
    'BS018': {
        // Variant without leading zero — map identically
        docnowStatus: 'Resample Required',
        isFinal: false,
        action: 'resample',
        source: '[OFFICIAL] "Resampling Process Initiated" (variant of BS0018)',
    },

    // ── Edge Cases ────────────────────────────────────────────────────────
    'BS0021': {
        docnowStatus: 'Missed Doctor Consultation',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Doctor Consultation Call Missed"',
    },
    'BS0023': {
        docnowStatus: 'Sample Rejected',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Sample got Reject due to some reason" — ref_booking_id provided',
    },
    'BS0026': {
        docnowStatus: 'Call Not Picked',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Sample Collector\'s Call Not Picked" — remarks provided',
    },
    'BS026': {
        docnowStatus: 'Call Not Picked',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Sample Collector\'s Call Not Picked" (variant of BS0026)',
    },
    'BS0027': {
        docnowStatus: 'Payment Hold',
        isFinal: false,
        action: 'update',
        source: '[OFFICIAL] "Booking is on-hold due to Payment Issue" — remarks provided',
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
    'BS0015': 'Your reports are being processed. Cancellation is no longer available.',
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

