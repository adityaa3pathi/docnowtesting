
export interface BookingHeader {
    id: string;
    partnerBookingId: string | null;
    currentPartnerBookingId?: string | null;
    previousPartnerBookingIds?: string[];
    partnerStatus?: string | null;
    status: string;
    paymentStatus?: string;
    slotDate: string;
    slotTime: string;
    totalAmount: number;
    createdAt: string;
    invoiceAvailable?: boolean;
    addressId?: string;
    rescheduledToId?: string | null;
    trackingReferenceUpdated?: boolean;
    bookingChangeType?: 'NONE' | 'RESCHEDULED' | 'RESAMPLED';
    bookingChangeMessage?: string | null;
    superseded?: boolean;
    items: string[];
    reports?: ReportSummary[];
}

export interface ReportSummary {
    id: string;
    isFullReport: boolean;
    fetchStatus: string;
    verifiedAt: string | null;
    fileSize: number | null;
    generatedAt: string;
}

export interface StatusDisplay {
    label: string;
    color: string;
    step: number;
    message: string;
    subMessage?: string;
    referenceCode?: string;
}

export interface BookingJourneyBanner {
    tone: 'info' | 'warning' | 'success';
    title: string;
    description: string;
}

export const STATUS_MAP: Record<string, StatusDisplay> = {
    'BS002': {
        label: 'Order Booked',
        color: 'bg-blue-100 text-blue-700',
        step: 1,
        message: 'Your booking has been placed successfully.',
    },
    'BS003': {
        label: 'Cancelled',
        color: 'bg-red-100 text-red-700',
        step: 0,
        message: 'This booking has been cancelled.',
    },
    'BS005': {
        label: 'Sample Collector Assigned',
        color: 'bg-purple-100 text-purple-700',
        step: 3,
        message: 'A phlebotomist has been assigned and will arrive during your selected slot.',
    },
    'BS007': {
        label: 'Sample Collected',
        color: 'bg-indigo-100 text-indigo-700',
        step: 4,
        message: 'Your sample has been collected and is moving for processing.',
    },
    'BS008': {
        label: 'Sample Received at Lab',
        color: 'bg-indigo-100 text-indigo-700',
        step: 4,
        message: 'Your sample has reached the lab and testing is underway.',
    },
    'BS0013': {
        label: 'Rescheduled',
        color: 'bg-yellow-100 text-yellow-700',
        step: 2,
        message: 'This booking has been rescheduled to a new slot.',
        subMessage: 'We have refreshed your booking with the latest schedule from our lab partner.',
    },
    'BS0018': {
        label: 'Fresh Sample Needed',
        color: 'bg-red-100 text-red-700',
        step: 2,
        message: 'The lab has asked for a fresh sample collection.',
        subMessage: 'Our team will help arrange the next slot for recollection.',
    },
    'BS018': {
        label: 'Fresh Sample Needed',
        color: 'bg-red-100 text-red-700',
        step: 2,
        message: 'The lab has asked for a fresh sample collection.',
        subMessage: 'Our team will help arrange the next slot for recollection.',
    },
    'Order Booked': {
        label: 'Order Booked',
        color: 'bg-blue-100 text-blue-700',
        step: 1,
        message: 'Your booking has been placed successfully.',
    },
    'Cancelled': {
        label: 'Cancelled',
        color: 'bg-red-100 text-red-700',
        step: 0,
        message: 'This booking has been cancelled.',
    },
    'Sample Collector Assigned': {
        label: 'Sample Collector Assigned',
        color: 'bg-purple-100 text-purple-700',
        step: 3,
        message: 'A phlebotomist has been assigned and will arrive during your selected slot.',
    },
    'Sample Collected': {
        label: 'Sample Collected',
        color: 'bg-indigo-100 text-indigo-700',
        step: 4,
        message: 'Your sample has been collected and is moving for processing.',
    },
    'Sample Received at Lab': {
        label: 'Sample Received at Lab',
        color: 'bg-indigo-100 text-indigo-700',
        step: 4,
        message: 'Your sample has reached the lab and testing is underway.',
    },
    'Rescheduled': {
        label: 'Rescheduled',
        color: 'bg-yellow-100 text-yellow-700',
        step: 2,
        message: 'Your collection slot has been updated.',
        subMessage: 'We have refreshed your booking with the latest schedule from our lab partner.',
    },
    'Superseded': {
        label: 'Superseded',
        color: 'bg-gray-100 text-gray-500',
        step: 0,
        message: 'This booking has been replaced by a newer booking reference.',
    },
    'Resample Required': {
        label: 'Fresh Sample Needed',
        color: 'bg-red-100 text-red-700',
        step: 2,
        message: 'The lab has asked for a fresh sample collection.',
        subMessage: 'Our team will help arrange the next slot for recollection.',
    },
    'Report Generated': {
        label: 'Report Ready',
        color: 'bg-green-100 text-green-700',
        step: 5,
        message: 'Your report is ready to download.',
    },
    'Awaiting Payment': {
        label: 'Awaiting Payment',
        color: 'bg-orange-100 text-orange-700',
        step: 0,
        message: 'Your booking will be confirmed once payment is received.',
    },
    'Refunded': {
        label: 'Refunded',
        color: 'bg-red-100 text-red-700',
        step: 0,
        message: 'This booking could not be completed and has been refunded.',
    },
};

export interface PhleboDetails {
    masked_number: string;
    phlebo_name: string;
}

const UNKNOWN_PARTNER_STATUS: StatusDisplay = {
    label: 'Processing Update Received',
    color: 'bg-slate-100 text-slate-700',
    step: 4,
    message: 'We have received an update from our lab partner. Your booking is moving forward.',
    subMessage: 'You can keep tracking this order for the latest status.',
};

export function extractPartnerCode(status?: string | null): string | undefined {
    if (!status) return undefined;
    const directMatch = status.match(/^BS\d+$/i);
    if (directMatch) return directMatch[0].toUpperCase();

    const embeddedMatch = status.match(/BS\d+/i);
    return embeddedMatch?.[0]?.toUpperCase();
}

export function getLatestReport(reports?: ReportSummary[]): ReportSummary | undefined {
    if (!reports?.length) return undefined;

    const stored = reports.filter((report) => report.fetchStatus === 'STORED');
    if (stored.length > 0) {
        return stored.find((report) => report.isFullReport) || stored[0];
    }

    const pending = reports.find((report) => report.fetchStatus === 'PENDING');
    if (pending) return pending;

    return reports[0];
}

export function getStatusDisplay(
    status?: string | null,
    reports?: ReportSummary[],
    partnerStatus?: string | null
): StatusDisplay {
    const latestReport = getLatestReport(reports);
    if (latestReport?.fetchStatus === 'STORED') {
        return STATUS_MAP['Report Generated'];
    }

    if (status && STATUS_MAP[status]) {
        return STATUS_MAP[status];
    }

    const partnerCode = extractPartnerCode(status);
    if (partnerCode && STATUS_MAP[partnerCode]) {
        return {
            ...STATUS_MAP[partnerCode],
            referenceCode: partnerCode,
        };
    }

    const partnerCodeFromPartnerStatus = extractPartnerCode(partnerStatus);
    if (partnerCodeFromPartnerStatus && STATUS_MAP[partnerCodeFromPartnerStatus]) {
        return {
            ...STATUS_MAP[partnerCodeFromPartnerStatus],
            referenceCode: partnerCodeFromPartnerStatus,
        };
    }

    if (partnerCodeFromPartnerStatus) {
        return {
            ...UNKNOWN_PARTNER_STATUS,
            referenceCode: partnerCodeFromPartnerStatus,
        };
    }

    if (partnerCode) {
        return {
            ...UNKNOWN_PARTNER_STATUS,
            referenceCode: partnerCode,
        };
    }

    return status
        ? {
            ...UNKNOWN_PARTNER_STATUS,
            label: status,
        }
        : UNKNOWN_PARTNER_STATUS;
}

export function getBookingJourneyBanner(booking: BookingHeader, statusInfo?: StatusDisplay): BookingJourneyBanner | null {
    if (booking.bookingChangeType === 'RESAMPLED') {
        return {
            tone: 'warning',
            title: 'Fresh sample requested',
            description:
                booking.bookingChangeMessage ||
                statusInfo?.subMessage ||
                'The lab has requested another sample collection for this booking.',
        };
    }

    if (booking.bookingChangeType === 'RESCHEDULED') {
        return {
            tone: 'info',
            title: 'Collection rescheduled',
            description:
                booking.bookingChangeMessage ||
                statusInfo?.subMessage ||
                'We have updated your booking with the latest schedule from our lab partner.',
        };
    }

    if (booking.trackingReferenceUpdated) {
        return {
            tone: 'info',
            title: 'Tracking reference updated',
            description: 'This order is still the same booking. Our lab partner has changed the underlying tracking reference.',
        };
    }

    return null;
}

export function getReportAction(reports?: ReportSummary[]) {
    const latestReport = getLatestReport(reports);
    if (!latestReport) {
        return { kind: 'none' as const };
    }

    if (latestReport.fetchStatus === 'STORED') {
        return { kind: 'download' as const, report: latestReport };
    }

    if (latestReport.fetchStatus === 'FAILED') {
        return { kind: 'retry' as const, report: latestReport };
    }

    return { kind: 'processing' as const, report: latestReport };
}
