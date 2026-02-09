"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBooking = createBooking;
const db_1 = require("../../db");
const healthians_1 = require("../../adapters/healthians");
const helpers_1 = require("../../utils/helpers");
const healthians = healthians_1.HealthiansAdapter.getInstance();
/**
 * POST /api/bookings - Create Booking
 */
async function createBooking(req, res) {
    const { slot_id, addressId, payment_option = 'prepaid' } = req.body;
    if (!slot_id || !addressId) {
        return res.status(400).json({ error: 'Missing slot_id or addressId' });
    }
    try {
        const userId = req.userId;
        // 1. Fetch User (for billing details)
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        // Validate Profile Completeness
        if (!user.name || !user.gender || !user.age) {
            return res.status(400).json({
                error: 'Profile incomplete. Please update your profile with Name, Gender and Age.',
                code: 'PROFILE_INCOMPLETE',
                missingFields: {
                    name: !user.name,
                    gender: !user.gender,
                    age: !user.age
                }
            });
        }
        // 2. Fetch Address
        const address = await db_1.prisma.address.findUnique({
            where: { id: addressId }
        });
        if (!address)
            return res.status(404).json({ error: 'Address not found' });
        // 3. Fetch Cart with Items and Patients
        const cart = await db_1.prisma.cart.findUnique({
            where: { userId },
            include: {
                items: {
                    include: {
                        patient: true
                    }
                }
            }
        });
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        // 4. Calculate Total Amount
        const totalAmount = cart.items.reduce((sum, item) => sum + item.price, 0);
        // 5. Group items by Patient
        const patientGroups = new Map();
        const getGroup = (key, patientData) => {
            if (!patientGroups.has(key)) {
                patientGroups.set(key, { patient: patientData, testCodes: [], testNames: [] });
            }
            return patientGroups.get(key);
        };
        for (const item of cart.items) {
            if (item.patientId && item.patient) {
                const group = getGroup(item.patientId, item.patient);
                group.testCodes.push(item.testCode);
                group.testNames.push(item.testName);
            }
            else {
                const selfPatient = {
                    id: user.id,
                    name: user.name,
                    relation: 'self',
                    age: user.age,
                    gender: user.gender,
                    mobile: user.mobile
                };
                const group = getGroup('self', selfPatient);
                group.testCodes.push(item.testCode);
                group.testNames.push(item.testName);
            }
        }
        // Construct arrays for API
        const customersPayload = [];
        const packagesPayload = [];
        // Fetch serviceability to get zone_id
        const serviceability = await healthians.checkServiceability(address.lat || '28.6139', address.long || '77.2090', address.pincode);
        const zoneId = serviceability?.data?.zone_id;
        if (!zoneId) {
            return res.status(400).json({ error: 'Could not determine zone_id for address' });
        }
        for (const [key, group] of patientGroups) {
            customersPayload.push({
                customer_id: group.patient.id,
                customer_name: group.patient.name,
                relation: group.patient.relation,
                age: group.patient.age,
                gender: (0, helpers_1.normalizeGender)(group.patient.gender),
                contact_number: user.mobile,
                email: user.email || '',
            });
            packagesPayload.push({
                deal_id: group.testCodes
            });
        }
        const bookingPayload = {
            customer: customersPayload,
            slot: {
                slot_id: slot_id
            },
            package: packagesPayload,
            customer_calling_number: user.mobile,
            billing_cust_name: user.name,
            gender: (0, helpers_1.normalizeGender)(user.gender),
            mobile: user.mobile,
            billing_gender: (0, helpers_1.normalizeGender)(user.gender),
            billing_mobile: user.mobile,
            email: user.email || '',
            billing_email: user.email || '',
            state: 26, // Hardcoded for now
            cityId: 23, // Hardcoded for now
            sub_locality: address.line1,
            latitude: address.lat,
            longitude: address.long,
            address: address.line1,
            zipcode: address.pincode,
            landmark: '',
            payment_option: payment_option,
            discounted_price: totalAmount,
            zone_id: zoneId,
            client_id: '',
            is_ppmc_booking: 0,
            vendor_billing_user_id: user.id
        };
        console.log('Creating Booking Payload:', JSON.stringify(bookingPayload, null, 2));
        const response = await healthians.createBooking(bookingPayload);
        console.log('Booking API Response:', JSON.stringify(response, null, 2));
        if (response.status) {
            const partnerBookingId = response.booking_id;
            const { slotDate = new Date().toISOString(), slotTime = 'Scheduled' } = req.body;
            const newBooking = await db_1.prisma.booking.create({
                data: {
                    userId: userId,
                    partnerBookingId: partnerBookingId ? partnerBookingId.toString() : null,
                    status: 'Order Booked',
                    slotDate: typeof slotDate === 'string' ? slotDate : JSON.stringify(slotDate),
                    slotTime: slotTime,
                    totalAmount: totalAmount,
                    paymentStatus: 'INITIATED',
                    items: {
                        create: cart.items
                            .filter(item => item.patientId)
                            .map(item => ({
                            testCode: item.testCode,
                            testName: item.testName,
                            price: item.price,
                            patientId: item.patientId
                        }))
                    }
                }
            });
            console.log('Local Booking Saved:', newBooking.id);
            // Clear Cart
            await db_1.prisma.cartItem.deleteMany({
                where: { cartId: cart.id }
            });
            // Return success with local ID too
            res.json({ ...response, local_booking_id: newBooking.id });
        }
        else {
            res.json(response);
        }
    }
    catch (error) {
        console.error('Create Booking Error:', error);
        res.status(500).json({ error: 'Failed to create booking' });
    }
}
