"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingService = exports.BookingService = void 0;
const db_1 = require("../db");
const healthians_1 = require("../adapters/healthians");
const healthians = healthians_1.HealthiansAdapter.getInstance();
/**
 * Booking Service - Shared business logic for booking operations
 */
class BookingService {
    /**
     * Get a booking with ownership verification
     */
    static async getBookingWithAuth(bookingId, userId, includeItems = false) {
        const booking = await db_1.prisma.booking.findFirst({
            where: { id: bookingId, userId },
            include: includeItems ? { items: true } : undefined
        });
        return booking;
    }
    /**
     * Get booking with user and items for status tracking
     */
    static async getBookingWithDetails(bookingId, userId) {
        return db_1.prisma.booking.findFirst({
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
    static async getHealthiansCustomers(partnerBookingId) {
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
    static async checkServiceability(lat, long, pincode) {
        return healthians.checkServiceability(lat, long, pincode);
    }
    /**
     * Get zone ID from serviceability response
     */
    static async getZoneId(lat, long, pincode) {
        const serviceability = await this.checkServiceability(lat, long, pincode);
        return serviceability?.data?.zone_id || null;
    }
    /**
     * Get user's addresses
     */
    static async getUserAddresses(userId) {
        return db_1.prisma.address.findMany({
            where: { userId },
            select: { id: true, line1: true, city: true, pincode: true, lat: true, long: true }
        });
    }
    /**
     * Get user's patients
     */
    static async getUserPatients(userId) {
        return db_1.prisma.patient.findMany({
            where: { userId },
            select: { id: true, name: true, relation: true, age: true, gender: true }
        });
    }
    /**
     * Build patient details map for status response enrichment
     */
    static buildPatientMap(booking) {
        const patientMap = {};
        // Add user as "Self"
        if (booking.user) {
            patientMap[booking.user.id] = {
                name: booking.user.name || 'User',
                relation: 'Self'
            };
        }
        // Add patients from booking items
        booking.items?.forEach((item) => {
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
exports.BookingService = BookingService;
exports.bookingService = new BookingService();
