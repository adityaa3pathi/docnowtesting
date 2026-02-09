import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';

const healthians = HealthiansAdapter.getInstance();

/**
 * Booking Service - Shared business logic for booking operations
 */
export class BookingService {
    /**
     * Get a booking with ownership verification
     */
    static async getBookingWithAuth(bookingId: string, userId: string, includeItems = false) {
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, userId },
            include: includeItems ? { items: true } : undefined
        });
        return booking;
    }

    /**
     * Get booking with user and items for status tracking
     */
    static async getBookingWithDetails(bookingId: string, userId: string) {
        return prisma.booking.findFirst({
            where: { id: bookingId, userId },
            include: {
                user: {
                    select: { id: true, name: true }
                },
                items: {
                    include: {
                        patient: {
                            select: { id: true, name: true, relation: true }
                        }
                    }
                }
            }
        });
    }

    /**
     * Get customers from Healthians status API
     * Returns the vendor_customer_id values needed for cancel/reschedule
     */
    static async getHealthiansCustomers(partnerBookingId: string) {
        const statusResponse = await healthians.getBookingStatus(partnerBookingId);
        return {
            customers: statusResponse?.data?.customer || [],
            bookingStatus: statusResponse?.data?.booking_status,
            statusResponse
        };
    }

    /**
     * Check serviceability for an address
     */
    static async checkServiceability(lat: string, long: string, pincode: string) {
        return healthians.checkServiceability(lat, long, pincode);
    }

    /**
     * Get zone ID from serviceability response
     */
    static async getZoneId(lat: string, long: string, pincode: string): Promise<string | null> {
        const serviceability = await this.checkServiceability(lat, long, pincode);
        return serviceability?.data?.zone_id || null;
    }

    /**
     * Get user's addresses
     */
    static async getUserAddresses(userId: string) {
        return prisma.address.findMany({
            where: { userId },
            select: { id: true, line1: true, city: true, pincode: true, lat: true, long: true }
        });
    }

    /**
     * Get user's patients
     */
    static async getUserPatients(userId: string) {
        return prisma.patient.findMany({
            where: { userId },
            select: { id: true, name: true, relation: true, age: true, gender: true }
        });
    }

    /**
     * Build patient details map for status response enrichment
     */
    static buildPatientMap(booking: any): Record<string, { name: string; relation: string }> {
        const patientMap: Record<string, { name: string; relation: string }> = {};

        // Add user as "Self"
        if (booking.user) {
            patientMap[booking.user.id] = {
                name: booking.user.name || 'User',
                relation: 'Self'
            };
        }

        // Add patients from booking items
        booking.items?.forEach((item: any) => {
            if (item.patient && item.patient.id) {
                patientMap[item.patient.id] = {
                    name: item.patient.name,
                    relation: item.patient.relation
                };
            }
        });

        return patientMap;
    }
}

export const bookingService = new BookingService();
