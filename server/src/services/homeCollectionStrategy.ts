import { BookingStrategy, BookingWithItems, PartnerResult, BookingRecord } from './bookingStrategy';
import { createHealthiansBooking } from './partnerBooking';
import { sendDeadLetterAlert } from '../utils/slack';

/**
 * Strategy implementation for home-collection bookings.
 *
 * Delegates partner finalization to the Healthians adapter via
 * {@link createHealthiansBooking} and applies standard cancellation
 * and rescheduling rules.
 */
export class HomeCollectionStrategy implements BookingStrategy {
    /** @inheritdoc */
    readonly type = 'home-collection';

    /**
     * Finalize the booking with Healthians for home collection.
     * @param booking - The full booking record including user, address, and items.
     * @param userId  - The authenticated user's ID.
     * @returns The partner result with the Healthians booking ID.
     */
    async finalizeWithPartner(booking: BookingWithItems, userId: string): Promise<PartnerResult> {
        const response = await createHealthiansBooking(booking, userId);
        return {
            type: 'home-collection-booked',
            partnerBookingId: response.booking_id,
        };
    }

    /**
     * Return the confirmed status label for home-collection bookings.
     */
    getConfirmedStatus(): string {
        return 'Order Booked';
    }

    /**
     * Handle a dead-letter booking by sending a Slack alert and requesting a refund.
     * @param booking   - The booking record that failed.
     * @param attempts  - Number of retry attempts made so far.
     * @param lastError - The last error message encountered.
     * @returns Always returns `'refund'` for home-collection bookings.
     */
    async handleDeadLetter(booking: BookingRecord, attempts: number, lastError: string): Promise<'refund' | 'alert_only'> {
        await sendDeadLetterAlert(booking.id, attempts, lastError);
        return 'refund';
    }

    /**
     * Home-collection bookings can always be cancelled by the customer.
     */
    canCustomerCancel(_booking: BookingRecord): { allowed: boolean; reason?: string } {
        return { allowed: true };
    }

    /**
     * Home-collection bookings can always be rescheduled.
     */
    canReschedule(_booking: BookingRecord): { allowed: boolean; reason?: string } {
        return { allowed: true };
    }
}
