import { sendTemplateViaWhatsApp } from './wappieWhatsApp';
import { prisma } from '../db';
import { logBusinessEvent } from '../utils/logger';

const WAPPIE_BOOKING_RESCHEDULE_TEMPLATE =
    process.env.WAPPIE_BOOKING_RESCHEDULE_TEMPLATE || 'booking_reschedule';
const WAPPIE_BOOKING_RESCHEDULE_LANGUAGE =
    process.env.WAPPIE_BOOKING_RESCHEDULE_LANGUAGE || 'en';

/**
 * Converts a raw date string (ISO / yyyy-mm-dd) into a human-readable format.
 * e.g. "2026-07-13T00:00:00.000Z" → "13 Jul 2026"
 */
function formatSlotDate(raw: string): string {
    if (!raw) return '';
    try {
        const d = new Date(raw);
        if (isNaN(d.getTime())) return raw;
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
 * Send booking reschedule WhatsApp message after a booking is rescheduled.
 * Self-contained — fetches booking data internally by the NEW booking's ID.
 *
 * Template parameters:
 *   {{1}} = Customer name
 *   {{2}} = Test name(s)
 *   {{3}} = New Date & Time
 */
export async function sendBookingRescheduledViaWhatsApp(newBookingId: string) {
    const booking = await prisma.booking.findUnique({
        where: { id: newBookingId },
        include: {
            user: { select: { name: true, mobile: true } },
            items: { select: { testName: true } },
        },
    });

    if (!booking?.user?.mobile) {
        return;
    }

    const customerName = (booking.user.name || 'Customer').trim();

    // Test names for {{2}}
    const testNames = booking.items.map((i) => i.testName).filter(Boolean);
    const testLabel =
        testNames.length === 0
            ? 'your booking'
            : testNames.length === 1
                ? testNames[0]
                : `${testNames[0]} + ${testNames.length - 1} more test${testNames.length - 1 > 1 ? 's' : ''}`;

    // New date & time for {{3}}
    const slotDate = booking.slotDate || '';
    const rawSlotTime = booking.slotTime || '';
    const slotTime = !rawSlotTime || /^\d+$/.test(rawSlotTime.trim()) ? '' : rawSlotTime.trim();
    const formattedDate = formatSlotDate(slotDate);
    const newDateTime = formattedDate && slotTime
        ? `${formattedDate}, ${slotTime}`
        : formattedDate || slotTime || 'To be confirmed';

    const result = await sendTemplateViaWhatsApp(
        booking.user.mobile,
        WAPPIE_BOOKING_RESCHEDULE_TEMPLATE,
        WAPPIE_BOOKING_RESCHEDULE_LANGUAGE,
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: customerName },
                    { type: 'text', text: testLabel },
                    { type: 'text', text: newDateTime },
                ],
            },
        ]
    );

    logBusinessEvent('booking_reschedule_notification_sent', {
        newBookingId,
        mobile: booking.user.mobile.slice(-4),
        messageId: result.id,
    });

    return result;
}
