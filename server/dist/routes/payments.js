"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookHandler = void 0;
const express_1 = require("express");
const razorpay_1 = __importDefault(require("razorpay"));
const crypto_1 = __importDefault(require("crypto"));
const auth_1 = require("../middleware/auth");
const db_1 = require("../db");
const healthians_1 = require("../adapters/healthians");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
const healthians = healthians_1.HealthiansAdapter.getInstance();
// Initialize Razorpay
const razorpay = new razorpay_1.default({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});
// ============================================
// POST /api/payments/initiate
// Creates Razorpay order and booking in INITIATED state
// ============================================
router.post('/initiate', auth_1.authMiddleware, async (req, res) => {
    const { slot_id, addressId } = req.body;
    const userId = req.userId;
    if (!slot_id || !addressId) {
        return res.status(400).json({ error: 'Missing slot_id or addressId' });
    }
    try {
        // 1. Fetch User
        const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        // Validate profile
        if (!user.name || !user.gender || !user.age) {
            return res.status(400).json({
                error: 'Profile incomplete',
                code: 'PROFILE_INCOMPLETE',
                missingFields: { name: !user.name, gender: !user.gender, age: !user.age }
            });
        }
        // 2. Fetch Cart
        const cart = await db_1.prisma.cart.findUnique({
            where: { userId },
            include: { items: { include: { patient: true } } }
        });
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        // 3. Calculate total SERVER-SIDE (critical for security)
        const totalAmount = cart.items.reduce((sum, item) => sum + item.price, 0);
        // 4. Check for existing INITIATED booking (idempotency)
        const existingBooking = await db_1.prisma.booking.findFirst({
            where: {
                userId,
                paymentStatus: 'INITIATED',
                createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) }
            }
        });
        if (existingBooking?.razorpayOrderId) {
            console.log('[Payments] Returning existing order:', existingBooking.razorpayOrderId);
            return res.json({
                bookingId: existingBooking.id,
                razorpayOrderId: existingBooking.razorpayOrderId,
                amount: totalAmount * 100,
                currency: 'INR',
                keyId: process.env.RAZORPAY_KEY_ID
            });
        }
        // 5. Fetch Address
        const address = await db_1.prisma.address.findUnique({ where: { id: addressId } });
        if (!address)
            return res.status(404).json({ error: 'Address not found' });
        // 6. Create booking in INITIATED state
        const booking = await db_1.prisma.booking.create({
            data: {
                userId,
                totalAmount,
                paymentStatus: 'INITIATED',
                slotDate: new Date().toISOString().split('T')[0],
                slotTime: slot_id,
                status: 'Payment Pending',
                addressId
            }
        });
        // 7. Create Razorpay order with booking binding
        const order = await razorpay.orders.create({
            amount: totalAmount * 100, // Razorpay expects paise
            currency: 'INR',
            receipt: booking.id, // Binding booking to order
            notes: { booking_id: booking.id }
        });
        // 8. Update booking with Razorpay order ID
        await db_1.prisma.booking.update({
            where: { id: booking.id },
            data: { razorpayOrderId: order.id }
        });
        console.log('[Payments] Order created:', order.id, 'for booking:', booking.id);
        res.json({
            bookingId: booking.id,
            razorpayOrderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID
        });
    }
    catch (error) {
        console.error('[Payments] Initiate error:', error);
        res.status(500).json({ error: 'Failed to initiate payment' });
    }
});
// ============================================
// POST /api/payments/verify
// Verifies payment and creates partner booking
// ============================================
router.post('/verify', auth_1.authMiddleware, async (req, res) => {
    const { bookingId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.userId;
    if (!bookingId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing required payment parameters' });
    }
    try {
        // 1. Fetch booking with ownership check
        const booking = await db_1.prisma.booking.findFirst({
            where: { id: bookingId, userId }
        });
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        // 2. Idempotency: Already confirmed
        if (booking.paymentStatus === 'CONFIRMED') {
            return res.json({ status: 'already_confirmed', bookingId });
        }
        // 3. Replay prevention: Payment ID already used
        if (booking.razorpayPaymentId) {
            return res.status(400).json({ error: 'Payment already processed for this booking' });
        }
        // 4. Verify signature (CRITICAL SECURITY CHECK)
        const expectedSignature = crypto_1.default
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        if (expectedSignature !== razorpay_signature) {
            console.error('[Payments] SECURITY: Signature mismatch for booking:', bookingId);
            await db_1.prisma.booking.update({
                where: { id: bookingId },
                data: { paymentStatus: 'FAILED' }
            });
            return res.status(400).json({ error: 'Payment verification failed' });
        }
        // 5. Re-fetch order from Razorpay to verify amount (defense in depth)
        const rzpOrder = await razorpay.orders.fetch(razorpay_order_id);
        if (rzpOrder.amount !== booking.totalAmount * 100) {
            console.error('[Payments] SECURITY: Amount mismatch', {
                expected: booking.totalAmount * 100,
                received: rzpOrder.amount
            });
            return res.status(400).json({ error: 'Amount mismatch detected' });
        }
        if (rzpOrder.notes?.booking_id !== bookingId) {
            console.error('[Payments] SECURITY: Booking ID mismatch in order notes');
            return res.status(400).json({ error: 'Booking mismatch detected' });
        }
        // 6. Mark as AUTHORIZED (payment is secured)
        await db_1.prisma.booking.update({
            where: { id: bookingId },
            data: {
                paymentStatus: 'AUTHORIZED',
                razorpayPaymentId: razorpay_payment_id,
                paidAt: new Date()
            }
        });
        console.log('[Payments] Payment AUTHORIZED for booking:', bookingId);
        // 7. Try to create partner booking
        try {
            const partnerResult = await createHealthiansBooking(booking, userId);
            // 8. Success - update to CONFIRMED in transaction
            await db_1.prisma.$transaction(async (tx) => {
                await tx.booking.update({
                    where: { id: bookingId },
                    data: {
                        paymentStatus: 'CONFIRMED',
                        partnerBookingId: partnerResult.booking_id?.toString() || null,
                        status: 'Order Booked'
                    }
                });
                // Clear cart
                await tx.cartItem.deleteMany({
                    where: { cart: { userId } }
                });
            });
            console.log('[Payments] Booking CONFIRMED:', bookingId);
            return res.json({ status: 'confirmed', bookingId });
        }
        catch (partnerError) {
            // 9. Partner failed - payment is secure, booking needs follow-up
            console.error('[Payments] Partner booking failed:', partnerError.message);
            await db_1.prisma.booking.update({
                where: { id: bookingId },
                data: {
                    paymentStatus: 'PARTNER_FAILED',
                    partnerError: partnerError.message || 'Healthians API failed'
                }
            });
            return res.status(200).json({
                status: 'payment_received_booking_pending',
                bookingId,
                message: 'Payment received. Your booking is being processed and you will receive confirmation shortly.'
            });
        }
    }
    catch (error) {
        console.error('[Payments] Verify error:', error);
        res.status(500).json({ error: 'Payment verification failed' });
    }
});
// ============================================
// Helper: Create Healthians Booking
// ============================================
async function createHealthiansBooking(booking, userId) {
    const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
    const address = await db_1.prisma.address.findUnique({ where: { id: booking.addressId } });
    const cart = await db_1.prisma.cart.findUnique({
        where: { userId },
        include: { items: { include: { patient: true } } }
    });
    if (!user || !address || !cart) {
        throw new Error('Missing required data for partner booking');
    }
    // Build patient groups
    const patientGroups = new Map();
    for (const item of cart.items) {
        const key = item.patientId || 'self';
        const patientData = item.patient || {
            id: user.id,
            name: user.name,
            relation: 'self',
            age: user.age,
            gender: user.gender
        };
        if (!patientGroups.has(key)) {
            patientGroups.set(key, { patient: patientData, testCodes: [], testNames: [] });
        }
        patientGroups.get(key).testCodes.push(item.testCode);
        patientGroups.get(key).testNames.push(item.testName);
    }
    // Get zone ID
    const serviceability = await healthians.checkServiceability(address.lat || '28.6139', address.long || '77.2090', address.pincode);
    const zoneId = serviceability?.data?.zone_id;
    if (!zoneId) {
        throw new Error('Could not determine zone for address');
    }
    // Build payload
    const customersPayload = [];
    const packagesPayload = [];
    for (const [, group] of patientGroups) {
        customersPayload.push({
            customer_id: group.patient.id,
            customer_name: group.patient.name,
            relation: group.patient.relation,
            age: group.patient.age,
            gender: (0, helpers_1.normalizeGender)(group.patient.gender),
            contact_number: user.mobile,
            email: user.email || ''
        });
        packagesPayload.push({ deal_id: group.testCodes });
    }
    const bookingPayload = {
        customer: customersPayload,
        slot: { slot_id: booking.slotTime },
        package: packagesPayload,
        customer_calling_number: user.mobile,
        billing_cust_name: user.name,
        gender: (0, helpers_1.normalizeGender)(user.gender),
        mobile: user.mobile,
        billing_gender: (0, helpers_1.normalizeGender)(user.gender),
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
        vendor_billing_user_id: user.id
    };
    console.log('[Payments] Creating Healthians booking:', JSON.stringify(bookingPayload, null, 2));
    const response = await healthians.createBooking(bookingPayload);
    if (!response.status) {
        throw new Error(response.message || 'Healthians booking failed');
    }
    // Create booking items in database
    await db_1.prisma.bookingItem.createMany({
        data: cart.items
            .filter(item => item.patientId)
            .map(item => ({
            bookingId: booking.id,
            testCode: item.testCode,
            testName: item.testName,
            price: item.price,
            patientId: item.patientId
        }))
    });
    return response;
}
// ============================================
// POST /api/payments/webhook
// Handles Razorpay webhooks (backup for verify)
// NOTE: This must be mounted BEFORE express.json()
// ============================================
const webhookHandler = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
        return res.status(401).json({ error: 'Missing signature' });
    }
    // 1. Verify webhook signature (using raw body)
    const isValid = razorpay_1.default.validateWebhookSignature(req.body.toString(), signature, process.env.RAZORPAY_WEBHOOK_SECRET);
    if (!isValid) {
        console.error('[Webhook] Invalid signature');
        return res.status(401).end();
    }
    const payload = JSON.parse(req.body.toString());
    const eventId = payload.event_id;
    const event = payload.event;
    console.log('[Webhook] Received:', event, eventId);
    // 2. Dedup check using WebhookEvent
    try {
        await db_1.prisma.webhookEvent.create({
            data: { eventId }
        });
    }
    catch (e) {
        if (e.code === 'P2002') { // Unique constraint violation
            console.log('[Webhook] Duplicate event ignored:', eventId);
            return res.status(200).json({ status: 'duplicate' });
        }
        throw e;
    }
    // 3. Process event
    if (event === 'payment.captured') {
        const payment = payload.payload.payment.entity;
        const orderId = payment.order_id;
        const booking = await db_1.prisma.booking.findFirst({
            where: { razorpayOrderId: orderId }
        });
        if (booking && booking.paymentStatus === 'INITIATED') {
            console.log('[Webhook] Processing payment for booking:', booking.id);
            // Mark as AUTHORIZED - partner booking will need manual follow-up
            await db_1.prisma.booking.update({
                where: { id: booking.id },
                data: {
                    paymentStatus: 'AUTHORIZED',
                    razorpayPaymentId: payment.id,
                    paidAt: new Date()
                }
            });
        }
    }
    res.status(200).json({ status: 'ok' });
};
exports.webhookHandler = webhookHandler;
// Regular routes (mounted with JSON parser)
exports.default = router;
