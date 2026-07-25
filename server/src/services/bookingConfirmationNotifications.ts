import { sendTemplateViaWhatsApp } from './wappieWhatsApp';
import { prisma } from '../db';
import { logAlert, logBusinessEvent } from '../utils/logger';

const WAPPIE_BOOKING_CONFIRMATION_TEMPLATE =
    process.env.WAPPIE_BOOKING_CONFIRMATION_TEMPLATE || 'booking_confirmation';
const WAPPIE_BOOKING_CONFIRMATION_LANGUAGE =
    process.env.WAPPIE_BOOKING_CONFIRMATION_LANGUAGE || 'en';

/**
 * Converts a raw date string (ISO / yyyy-mm-dd) into a human-readable format.
 * e.g. "2026-07-13T00:00:00.000Z" → "13 Jul 2026"
 *      "2026-07-13"               → "13 Jul 2026"
 */
function formatSlotDate(raw: string): string {
    if (!raw) return '';
    try {
        const d = new Date(raw);
        if (isNaN(d.getTime())) return raw; // fallback to original if unparseable
        return d.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Kolkata',
        });
    } catch {
        return raw;
    }
}

/**
 * Send booking confirmation WhatsApp message after a booking is confirmed.
 * Fetches booking data internally so callers just pass the bookingId.
 *
 * Template parameters:
 *   {{1}} = Customer name
 *   {{2}} = Patient name(s)
 *   {{3}} = Scheduled Date & Time
 */
export async function sendBookingConfirmationViaWhatsApp(bookingId: string) {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            user: { select: { name: true, mobile: true } },
            items: {
                include: { patient: { select: { name: true } } },
            },
        },
    });

    if (!booking?.user?.mobile) {
        return;
    }

    // Customer name (account holder)
    const customerName = (booking.user.name || 'Customer').trim();

    // Unique patient names
    const patientNames = [...new Set(
        booking.items.map((item) => item.patient?.name).filter(Boolean)
    )] as string[];
    const patientLabel = patientNames.length > 0
        ? patientNames.join(', ')
        : customerName;

    // Format date & time
    const slotDate = booking.slotDate || '';
    const rawSlotTime = booking.slotTime || '';
    const slotTime = !rawSlotTime || /^\d+$/.test(rawSlotTime.trim()) ? '' : rawSlotTime.trim();

    const formattedDate = formatSlotDate(slotDate);
    const scheduledDateTime = formattedDate && slotTime
        ? `${formattedDate}, ${slotTime}`
        : formattedDate || slotTime || 'To be confirmed';

    const result = await sendTemplateViaWhatsApp(
        booking.user.mobile,
        WAPPIE_BOOKING_CONFIRMATION_TEMPLATE,
        WAPPIE_BOOKING_CONFIRMATION_LANGUAGE,
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: customerName },
                    { type: 'text', text: patientLabel },
                    { type: 'text', text: scheduledDateTime },
                ],
            },
        ]
    );

    logBusinessEvent('booking_confirmation_notification_sent', {
        bookingId,
        mobile: booking.user.mobile.slice(-4),
        messageId: result.id,
    });

    return result;
}
