import { sendTemplateViaWhatsApp } from './wappieWhatsApp';
import { prisma } from '../db';
import { logBusinessEvent } from '../utils/logger';

const WAPPIE_BOOKING_CANCELLED_TEMPLATE =
    process.env.WAPPIE_BOOKING_CANCELLED_TEMPLATE || 'booking_cancelled';
const WAPPIE_BOOKING_CANCELLED_LANGUAGE =
    process.env.WAPPIE_BOOKING_CANCELLED_LANGUAGE || 'en';

/**
 * Send booking cancellation WhatsApp message after a booking is cancelled.
 * Self-contained — fetches booking data internally by bookingId.
 *
 * Template parameters:
 *   {{1}} = Customer name
 *   {{2}} = Test name(s) booked
 */
export async function sendBookingCancelledViaWhatsApp(bookingId: string) {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            user: { select: { name: true, mobile: true } },
            items: {
                select: {
                    testName: true,
                    patient: { select: { name: true } },
                },
            },
        },
    });

    if (!booking?.user?.mobile) {
        return;
    }

    // Customer name (account holder)
    const customerName = (booking.user.name || 'Customer').trim();

    // Test names for {{2}}
    const testNames = booking.items.map((i) => i.testName).filter(Boolean);
    const testLabel =
        testNames.length === 0
            ? 'your booking'
            : testNames.length === 1
                ? testNames[0]
                : `${testNames[0]} + ${testNames.length - 1} more test${testNames.length - 1 > 1 ? 's' : ''}`;

    const result = await sendTemplateViaWhatsApp(
        booking.user.mobile,
        WAPPIE_BOOKING_CANCELLED_TEMPLATE,
        WAPPIE_BOOKING_CANCELLED_LANGUAGE,
        [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: customerName },
                    { type: 'text', text: testLabel },
                ],
            },
        ]
    );

    logBusinessEvent('booking_cancelled_notification_sent', {
        bookingId,
        mobile: booking.user.mobile.slice(-4),
        messageId: result.id,
    });

    return result;
}
