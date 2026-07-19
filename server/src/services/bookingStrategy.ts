/**
 * Result returned by a strategy after finalizing with a partner.
 */
export interface PartnerResult {
    type: 'home-collection-booked' | 'camp-registered';
    partnerBookingId?: string;
}

/**
 * Minimal booking record used across strategy methods.
 */
export interface BookingRecord {
    id: string;
    campId: string | null;
    partnerBookingId: string | null;
    razorpayPaymentId: string | null;
    [key: string]: any;
}

/**
 * Extended booking record that includes user, address, and line items.
 */
export interface BookingWithItems extends BookingRecord {
    user: any;
    address: any;
    items: any[];
}

/**
 * Strategy interface for booking fulfillment.
 *
 * Each booking type (home-collection, camp, etc.) implements this interface
 * to encapsulate its partner integration, status mapping, dead-letter handling,
 * and customer self-service rules.
 */
export interface BookingStrategy {
    /** Unique identifier for this strategy (e.g. 'home-collection', 'camp'). */
    readonly type: string;

    /**
     * Finalize the booking with the external partner.
     * @param booking - The full booking record including user, address, and items.
     * @param userId  - The authenticated user's ID.
     * @returns The partner result containing the partner booking ID.
     */
    finalizeWithPartner(booking: BookingWithItems, userId: string): Promise<PartnerResult>;

    /**
     * Return the human-readable status string used after successful confirmation.
     */
    getConfirmedStatus(): string;

    /**
     * Handle a booking that has landed in the dead-letter queue.
     * @param booking   - The booking record that failed.
     * @param attempts  - Number of retry attempts made so far.
     * @param lastError - The last error message encountered.
     * @returns Whether the system should issue a refund or only raise an alert.
     */
    handleDeadLetter(booking: BookingRecord, attempts: number, lastError: string): Promise<'refund' | 'alert_only'>;

    /**
     * Determine whether the customer is allowed to cancel the booking.
     * @param booking - The booking record to evaluate.
     */
    canCustomerCancel(booking: BookingRecord): { allowed: boolean; reason?: string };

    /**
     * Determine whether the booking can be rescheduled.
     * @param booking - The booking record to evaluate.
     */
    canReschedule(booking: BookingRecord): { allowed: boolean; reason?: string };
}
