import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';
import { normalizeGender } from '../utils/helpers';

const healthians = HealthiansAdapter.getInstance();

/**
 * Creates a booking with the Healthians partner API.
 * Builds patient groups from booking items, resolves zone, and submits.
 */
export async function createHealthiansBooking(booking: any, userId: string, slotId?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const address = await prisma.address.findUnique({ where: { id: booking.addressId } });

    // Ensure we have booking items
    let bookingItems = booking.items;
    if (!bookingItems) {
        // Fallback: fetch items if not passed in parent object
        bookingItems = await prisma.bookingItem.findMany({
            where: { bookingId: booking.id },
            include: { patient: true }
        });
    }

    if (!user || !address || !bookingItems || bookingItems.length === 0) {
        throw new Error('Missing required data for partner booking (User, Address, or Items)');
    }

    // Build patient groups from Immutable Booking Items
    const patientGroups = new Map<string, { patient: any, testCodes: string[], testNames: string[] }>();

    for (const item of bookingItems) {
        const key = item.patientId;
        let patientData = item.patient;
        if (!patientData) {
            patientData = await prisma.patient.findUnique({ where: { id: item.patientId } });
        }

        if (!patientData) throw new Error(`Patient data not found for BookingItem ${item.id}`);

        if (!patientGroups.has(key)) {
            patientGroups.set(key, { patient: patientData, testCodes: [], testNames: [] });
        }
        patientGroups.get(key)!.testCodes.push(item.testCode);
        patientGroups.get(key)!.testNames.push(item.testName);
    }

    // Get zone ID
    const serviceability = await healthians.checkServiceability(
        address.lat || '28.6139',
        address.long || '77.2090',
        address.pincode
    );
    const zoneId = serviceability?.data?.zone_id;

    if (!zoneId) {
        throw new Error('Could not determine zone for address');
    }

    // Build payload
    const customersPayload: any[] = [];
    const packagesPayload: any[] = [];

    for (const [, group] of patientGroups) {
        customersPayload.push({
            customer_id: group.patient.id,
            customer_name: group.patient.name,
            relation: group.patient.relation,
            age: group.patient.age,
            gender: normalizeGender(group.patient.gender),
            contact_number: user.mobile,
            email: user.email || ''
        });
        packagesPayload.push({ deal_id: group.testCodes });
    }

    const bookingPayload = {
        customer: customersPayload,
        slot: { slot_id: booking.partnerSlotId || slotId || booking.slotTime },
        package: packagesPayload,
        customer_calling_number: user.mobile,
        billing_cust_name: booking.billingName || user.name,
        gender: normalizeGender(user.gender),
        mobile: user.mobile,
        billing_gender: normalizeGender(booking.billingGender || user.gender),
        billing_mobile: user.mobile,
        email: user.email || '',
        billing_email: user.email || '',
        state: 26,
        cityId: 23,
        sub_locality: address.line1,
        latitude: address.lat,
        longitude: address.long,
        address: address.line1,
        zipcode: address.pincode,
        landmark: '',
        payment_option: 'prepaid',
        discounted_price: booking.totalAmount,
        zone_id: zoneId,
        client_id: '',
        is_ppmc_booking: 0,
        vendor_booking_id: booking.id, // For idempotency/reconciliation
        vendor_billing_user_id: user.id
    };

    console.log('[Payments] Creating Healthians booking:', JSON.stringify(bookingPayload, null, 2));

    const response = await healthians.createBooking(bookingPayload);
    console.log('[Payments] Healthians Booking Response:', JSON.stringify(response, null, 2));

    if (!response.status) {
        throw new Error(response.message || 'Healthians booking failed');
    }

    const partnerBookingId = response.booking_id || response.data?.booking_id;

    if (!partnerBookingId) {
        throw new Error('Healthians booking successful but booking_id missing in response');
    }

    // Normalize response to always have booking_id at top level
    if (!response.booking_id && partnerBookingId) {
        response.booking_id = partnerBookingId;
    }

    return response;
}
