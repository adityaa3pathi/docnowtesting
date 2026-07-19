/**
 * Camp Registration Strategy
 * 
 * Implements the BookingStrategy interface for health camp registrations.
 * Instead of creating a Healthians booking (home collection),
 * this strategy registers the user via the /userRegistration API.
 * 
 * Camp bookings cannot be cancelled or rescheduled by users.
 * Failed registrations alert the admin instead of auto-refunding.
 */
import { BookingStrategy, BookingWithItems, PartnerResult, BookingRecord } from '../../services/bookingStrategy';
import { HealthiansAdapter } from '../../adapters/healthians';
import { prisma } from '../../db';
import { sendDeadLetterAlert } from '../../utils/slack';
import { logBusinessEvent, logAlert } from '../../utils/logger';

const healthians = HealthiansAdapter.getInstance();

// ── Normalization Helpers ────────────────────────────────

/**
 * Lowercase relation for Healthians registration API.
 * Our DB stores Title Case ('Self', 'Spouse') but Healthians expects lowercase.
 */
function normalizeRelation(relation: string): string {
    return (relation || 'self').toLowerCase();
}

/**
 * Healthians /userRegistration expects 'male'/'female', not 'M'/'F'.
 * Our normalizeGender() returns 'M'/'F' which is for createBooking, not registration.
 */
function normalizeGenderForRegistration(g?: string | null): string {
    if (!g) return 'male';
    const lower = g.toLowerCase();
    if (lower.startsWith('f')) return 'female';
    return 'male';
}

/**
 * Format DOB for Healthians as YYYY-MM-DD.
 * Falls back to an approximate date derived from age if DOB is not available.
 */
function formatDob(dob: Date | string | null | undefined, age: number): string {
    if (dob) {
        return new Date(dob).toISOString().split('T')[0];
    }
    // Fallback: estimate DOB from age
    return `${new Date().getFullYear() - age}-01-01`;
}

// ── Strategy Implementation ─────────────────────────────

export class CampRegistrationStrategy implements BookingStrategy {
    readonly type = 'camp';

    /**
     * Register the user with Healthians for a camp.
     * Uses /userRegistration API instead of /createBooking.
     */
    async finalizeWithPartner(booking: BookingWithItems, userId: string): Promise<PartnerResult> {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User not found for camp registration');

        // Get patient from the first booking item
        let patient = booking.items[0]?.patient;
        if (!patient) {
            const item = await prisma.bookingItem.findFirst({
                where: { bookingId: booking.id },
                include: { patient: true },
            });
            patient = item?.patient;
        }
        if (!patient) throw new Error('Patient not found for camp registration');

        // Composite vendor_customer_id preserves both booking and patient identity
        // Format: camp:{bookingId}:{patientId}
        // This allows webhooks to find the booking AND identify the patient for report dedup
        const vendorCustomerId = `camp:${booking.id}:${patient.id}`;

        const response = await healthians.registerCampUser({
            mobile_number: user.mobile,
            name: patient.name,
            age: String(patient.age),
            gender: normalizeGenderForRegistration(patient.gender),
            email: user.email || '',
            vendor_customer_id: vendorCustomerId,
            dob: formatDob(patient.dob, patient.age),
            relation: normalizeRelation(patient.relation),
        });

        if (!response.status) {
            throw new Error(response.message || 'Healthians camp registration failed');
        }

        logBusinessEvent('camp_user_registered', {
            bookingId: booking.id,
            patientId: patient.id,
            vendorCustomerId,
        });

        // Camp registration doesn't return a booking_id like createBooking does.
        // The partnerBookingId will be backfilled when Healthians sends webhooks.
        return { type: 'camp-registered' };
    }

    /**
     * Camp bookings show "Registered" instead of "Order Booked".
     */
    getConfirmedStatus(): string {
        return 'Registered';
    }

    /**
     * For camp dead-letters: alert admin, don't auto-refund.
     * User may already be physically at the camp — refunding would be wrong.
     */
    async handleDeadLetter(booking: BookingRecord, attempts: number, lastError: string): Promise<'alert_only'> {
        await sendDeadLetterAlert(
            booking.id,
            attempts,
            `CAMP BOOKING — Registration with Healthians failed after ${attempts} attempts. ` +
            `Last error: ${lastError}. Manual intervention required.`
        );
        logAlert('camp_registration_dead_lettered', {
            bookingId: booking.id,
            attempts,
            lastError,
        });
        return 'alert_only';
    }

    /**
     * Camp registrations cannot be cancelled online.
     */
    canCustomerCancel(): { allowed: false; reason: string } {
        return {
            allowed: false,
            reason: 'Camp registrations cannot be cancelled online. Please contact support for assistance.',
        };
    }

    /**
     * Camp registrations cannot be rescheduled — the camp has fixed dates.
     */
    canReschedule(): { allowed: false; reason: string } {
        return {
            allowed: false,
            reason: 'Camp registrations cannot be rescheduled. The camp has fixed dates.',
        };
    }
}
