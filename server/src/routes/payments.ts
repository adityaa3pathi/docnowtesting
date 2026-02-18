import { Router, Response, Request } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';
import { normalizeGender } from '../utils/helpers';
import { calculateDiscount } from '../utils/promoHelper';
import { assertTransition } from '../utils/paymentStateMachine';
import { tryAwardFirstOrderBonus } from '../utils/referralService';

const router = Router();
const healthians = HealthiansAdapter.getInstance();

// Initialize Razorpay Lazily or Safely
let razorpay: Razorpay;

try {
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    } else {
        console.warn('[Razorpay] Warning: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing. Payment routes will fail.');
    }
} catch (err) {
    console.error('[Razorpay] Initialization failed:', err);
}

// Helper to get instance or throw
const getRazorpay = () => {
    if (!razorpay) {
        throw new Error('Razorpay is not initialized. Check server environment variables.');
    }
    return razorpay;
};

// ============================================
// POST /api/payments/initiate
// Creates Booking + Locks Promo + Deducts Wallet + Creates Razorpay Order
// ============================================
router.post('/initiate', authMiddleware, rateLimiter(1, 10, 'initiate'), async (req: AuthRequest, res: Response) => {
    const { slot_id, slotLabel, slotDate: clientSlotDate, addressId, promoCode: rawPromoCode, useWallet, billingPatientId } = req.body;
    const idempotencyKey = (req.headers['x-idempotency-key'] as string) || req.body.idempotencyKey;
    const userId = req.userId!;

    // Normalize promo code
    const promoCode = rawPromoCode ? rawPromoCode.trim().toUpperCase() : undefined;

    if (!slot_id || !addressId) {
        return res.status(400).json({ error: 'Missing slot_id or addressId' });
    }

    try {

        // 0. Idempotency: Return existing booking if key matches
        if (idempotencyKey) {
            const existing = await prisma.booking.findUnique({
                where: { idempotencyKey }
            });
            if (existing && ['INITIATED', 'AUTHORIZED', 'CONFIRMED', 'PAID'].includes(existing.paymentStatus)) {
                console.log('[Payments] Idempotent hit — returning existing booking:', existing.id);
                return res.json({
                    bookingId: existing.id,
                    razorpayOrderId: existing.razorpayOrderId,
                    amount: existing.finalAmount * 100,
                    currency: 'INR',
                    keyId: process.env.RAZORPAY_KEY_ID,
                    idempotent: true
                });
            }
        }

        // 1. Fetch Prerequisites (User, Address — NOT cart, cart moves into tx)
        const [user, address] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } }),
            prisma.address.findUnique({ where: { id: addressId } })
        ]);

        if (!user || !address) return res.status(404).json({ error: 'User or Address not found' });

        // Validate profile
        if (!user.name || !user.gender || !user.age) {
            return res.status(400).json({
                error: 'Profile incomplete',
                code: 'PROFILE_INCOMPLETE',
                missingFields: { name: !user.name, gender: !user.gender, age: !user.age }
            });
        }

        // 2. Core Calculation & Transaction (NO network calls inside tx)
        //    Cart is now read INSIDE the transaction for price consistency
        const { booking, finalAmount } = await prisma.$transaction(async (tx) => {
            // A. Read cart inside tx — prevents TOCTOU (prices changing between read and booking)
            const cart = await tx.cart.findUnique({
                where: { userId },
                include: { items: { include: { patient: true } } }
            });
            if (!cart || cart.items.length === 0) throw new Error('Cart is empty');

            // A2. Checkout guard: validate all cart items against internal catalog
            const testCodes = cart.items.map(i => i.testCode);
            const catalogItems = await tx.catalogItem.findMany({
                where: { partnerCode: { in: testCodes } },
                select: { partnerCode: true, isEnabled: true, name: true }
            });
            const catalogMap = new Map(catalogItems.map(c => [c.partnerCode, c]));
            const disabledItems = cart.items.filter(item => {
                const cat = catalogMap.get(item.testCode);
                return !cat || !cat.isEnabled;
            });
            if (disabledItems.length > 0) {
                throw new Error(`DISABLED_ITEMS:${JSON.stringify(disabledItems.map(i => ({ testCode: i.testCode, testName: i.testName })))}`);
            }

            // B. Calculate Base Total
            const totalAmount = cart.items.reduce((sum, item) => sum + item.price, 0);
            let discountAmount = 0;
            let walletAmount = 0;
            let promoCodeId: string | null = null;

            // B. Promo Code Logic (Atomic)
            if (promoCode) {
                const promo = await tx.promoCode.findUnique({ where: { code: promoCode } });

                if (!promo || !promo.isActive) throw new Error('Invalid or inactive promo code');
                if (promo.expiresAt && new Date() > promo.expiresAt) throw new Error('Promo code expired');
                if (new Date() < promo.startsAt) throw new Error('Promo code not yet active');
                if (totalAmount < promo.minOrderValue) throw new Error(`Minimum order value of ₹${promo.minOrderValue} required`);

                // Per-user limit check (prevent abuse)
                const existingRedemption = await tx.promoRedemption.findFirst({
                    where: { userId, promoCodeId: promo.id }
                });
                if (existingRedemption) throw new Error('You have already used this promo code');

                // Atomic Increment & Check Limit
                if (promo.maxRedemptions !== null) {
                    const result = await tx.promoCode.updateMany({
                        where: {
                            id: promo.id,
                            redeemedCount: { lt: promo.maxRedemptions }
                        },
                        data: { redeemedCount: { increment: 1 } }
                    });
                    if (result.count === 0) throw new Error('Promo usage limit reached');
                } else {
                    await tx.promoCode.update({
                        where: { id: promo.id },
                        data: { redeemedCount: { increment: 1 } }
                    });
                }

                console.log('[Payments] Promo locked:', promo.code);

                discountAmount = calculateDiscount(promo, totalAmount);
                promoCodeId = promo.id;
            }

            // C. Wallet Logic (Atomic)
            if (useWallet && user.wallet) {
                const payableAfterDiscount = totalAmount - discountAmount;
                const walletBalance = user.wallet.balance;
                const amountToDeduct = Math.min(walletBalance, payableAfterDiscount);

                if (amountToDeduct > 0) {
                    // Atomic Deduct with optimistic locking
                    const result = await tx.wallet.updateMany({
                        where: {
                            id: user.wallet.id,
                            balance: { gte: amountToDeduct }
                        },
                        data: { balance: { decrement: amountToDeduct } }
                    });

                    if (result.count === 0) throw new Error('Insufficient wallet balance during processing');

                    walletAmount = amountToDeduct;
                    console.log('[Payments] Wallet debited:', walletAmount);
                    // Ledger entry created after booking (Section F) to include bookingId reference
                }
            }

            // D. Resolve "self" patient for items without explicit patientId
            // CartItem.patientId is nullable (for self-bookings), but BookingItem.patientId is required.
            // Auto-create/resolve a "self" patient record so every BookingItem has a valid FK.
            let selfPatientId: string | null = null;
            const hasNullPatient = cart.items.some(item => !item.patientId);

            if (hasNullPatient) {
                // Find existing "Self" patient for this user
                let selfPatient = await tx.patient.findFirst({
                    where: { userId, relation: { in: ['Self', 'self'] } }
                });

                // Auto-create if not found
                if (!selfPatient) {
                    selfPatient = await tx.patient.create({
                        data: {
                            userId,
                            name: user.name || 'Self',
                            relation: 'Self',
                            age: user.age || 25,
                            gender: user.gender || 'Male'
                        }
                    });
                    console.log('[Payments] Auto-created self patient:', selfPatient.id);
                }

                selfPatientId = selfPatient.id;
            }

            // E. Resolve billing name if a patient was selected
            let billingName: string | null = null;
            let billingGender: string | null = null;
            if (billingPatientId) {
                const billingPatient = await tx.patient.findUnique({ where: { id: billingPatientId } });
                if (billingPatient && billingPatient.userId === userId) {
                    billingName = billingPatient.name;
                    billingGender = billingPatient.gender;
                }
            }

            // F. Create Booking
            const finalAmount = Math.max(0, totalAmount - discountAmount - walletAmount);

            const newBooking = await tx.booking.create({
                data: {
                    userId,
                    addressId,
                    billingName,
                    billingGender,
                    status: 'PENDING',
                    paymentStatus: 'INITIATED',
                    slotDate: clientSlotDate || new Date().toISOString().split('T')[0],
                    slotTime: slotLabel || slot_id,
                    totalAmount,
                    discountAmount,
                    walletAmount,
                    finalAmount,
                    promoCodeId,
                    idempotencyKey: idempotencyKey || undefined,
                    items: {
                        create: cart.items.map(item => ({
                            patientId: item.patientId || selfPatientId!,
                            testCode: item.testCode,
                            testName: item.testName,
                            price: item.price
                        }))
                    }
                },
                include: { items: { include: { patient: true } } }
            });

            // E. Link Promo Redemption
            if (promoCodeId) {
                await tx.promoRedemption.create({
                    data: {
                        userId,
                        promoCodeId,
                        bookingId: newBooking.id
                    }
                });
            }

            // F. Wallet Ledger Entry (with accurate post-decrement balance)
            if (walletAmount > 0 && user.wallet) {
                // Read actual post-decrement balance (not stale cached value)
                const updatedWallet = await tx.wallet.findUnique({ where: { id: user.wallet.id } });

                await tx.walletLedger.create({
                    data: {
                        walletId: user.wallet.id,
                        type: 'DEBIT',
                        amount: -walletAmount,
                        balanceAfter: updatedWallet!.balance, // Accurate post-decrement
                        description: `Used for booking #${newBooking.id.slice(0, 8)}`,
                        referenceType: 'ORDER',
                        referenceId: newBooking.id
                    }
                });
            }

            // G. Zero-amount path (100% discount or wallet covers everything)
            if (finalAmount === 0) {
                await tx.booking.update({
                    where: { id: newBooking.id },
                    data: {
                        paymentStatus: 'PAID',
                        razorpayPaymentId: `ZERO_${newBooking.id}`,
                        paidAt: new Date()
                    }
                });
            }

            return { booking: newBooking, finalAmount, currency: 'INR' };
        }, {
            maxWait: 5000,
            timeout: 10000
        });

        // ═══════════════════════════════════════════════════════
        // OUTSIDE TRANSACTION: Network calls are safe here
        // Razorpay order creation must NOT be inside the DB tx,
        // otherwise a slow Razorpay response holds DB connections
        // and can cause connection pool starvation under load.
        // ═══════════════════════════════════════════════════════
        if (finalAmount > 0) {
            let razorpayOrder;
            try {
                razorpayOrder = await getRazorpay().orders.create({
                    amount: Math.round(finalAmount * 100),
                    currency: 'INR',
                    receipt: booking.id,
                    notes: { bookingId: booking.id }
                });

                await prisma.booking.update({
                    where: { id: booking.id },
                    data: { razorpayOrderId: razorpayOrder.id }
                });
            } catch (rzpError: any) {
                // Razorpay failed — rollback wallet + promo, mark FAILED
                console.error('[Payments] Razorpay order creation failed:', rzpError.message);
                assertTransition('INITIATED' as any, 'FAILED' as any);
                await prisma.booking.update({
                    where: { id: booking.id },
                    data: { paymentStatus: 'FAILED' }
                });
                await rollbackInitiatedBooking(booking);
                return res.status(500).json({ error: 'Payment gateway error. Please try again.' });
            }

            return res.json({
                bookingId: booking.id,
                razorpayOrderId: razorpayOrder.id,
                amount: finalAmount * 100,
                currency: 'INR',
                keyId: process.env.RAZORPAY_KEY_ID
            });
        }

        // Handle Zero Amount - Instant Confirmation
        if (finalAmount === 0) {
            console.log('[Payments] Zero amount booking, confirming immediately:', booking.id);
            try {
                const partnerResult = await createHealthiansBooking(booking, userId, slot_id);
                assertTransition('PAID' as any, 'CONFIRMED' as any);
                await prisma.booking.update({
                    where: { id: booking.id },
                    data: {
                        paymentStatus: 'CONFIRMED',
                        partnerBookingId: partnerResult.booking_id?.toString() || null,
                        status: 'Order Booked'
                    }
                });
                // Clear cart
                await prisma.cartItem.deleteMany({
                    where: { cart: { userId } }
                });

                // Award referral bonus (non-blocking)
                tryAwardFirstOrderBonus(userId, booking.id).catch(err =>
                    console.error('[Payments] First-order referral bonus failed:', err.message)
                );

                return res.json({
                    bookingId: booking.id,
                    status: 'confirmed',
                    amount: 0
                });
            } catch (error) {
                console.error('[Payments] Partner booking failed for zero amount:', error);
                assertTransition('PAID' as any, 'PARTNER_FAILED' as any);
                await prisma.booking.update({
                    where: { id: booking.id },
                    data: { paymentStatus: 'PARTNER_FAILED', partnerError: (error as Error).message || 'Partner API failed' }
                });
                // Enqueue for retry
                await prisma.partnerRetry.upsert({
                    where: { bookingId: booking.id },
                    create: { bookingId: booking.id, nextRetryAt: new Date(Date.now() + 60_000), lastError: (error as Error).message },
                    update: {}
                });
                // Still clear cart — booking exists, user shouldn't re-order
                await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
                return res.json({
                    bookingId: booking.id,
                    status: 'payment_received_booking_pending',
                    amount: 0
                });
            }
        }

        // Should not reach here
        return res.status(500).json({ error: 'Unexpected flow' });

    } catch (error: any) {
        console.error('[Payments] Initiate Error:', error);

        // Checkout guard: return clear error for disabled items
        if (error.message?.startsWith('DISABLED_ITEMS:')) {
            const disabledItems = JSON.parse(error.message.replace('DISABLED_ITEMS:', ''));
            return res.status(400).json({
                error: 'Cart contains unavailable items. Please remove them before checkout.',
                code: 'DISABLED_ITEMS',
                disabledItems
            });
        }

        res.status(500).json({ error: error.message || 'Payment initiation failed' });
    }
});

// ============================================
// POST /api/payments/verify
// Verifies payment and creates partner booking
// ============================================
router.post('/verify', authMiddleware, async (req: AuthRequest, res: Response) => {
    const { bookingId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.userId!;

    if (!bookingId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing required payment parameters' });
    }

    try {
        // 1. Fetch booking with ownership check
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, userId },
            include: {
                promoCode: true,
                user: { include: { wallet: true } },
                items: { include: { patient: true } } // Include items for partner booking
            }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // 2. Idempotency: Only return early if truly CONFIRMED (partner booking done, cart cleared)
        if (booking.paymentStatus === 'CONFIRMED') {
            return res.json({ status: 'confirmed', message: 'Payment already verified' });
        }

        // 3. If AUTHORIZED (webhook arrived first), skip signature/amount checks
        //    but proceed to create partner booking + clear cart
        const alreadyAuthorized = booking.paymentStatus === 'AUTHORIZED';

        if (!alreadyAuthorized) {
            // 4. Replay prevention: Payment ID already used
            if (booking.razorpayPaymentId) {
                return res.status(400).json({ error: 'Payment already processed for this booking' });
            }

            // 5. Verify signature (CRITICAL SECURITY CHECK)
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

            if (expectedSignature !== razorpay_signature) {
                console.error('[Payments] SECURITY: Signature mismatch for booking:', bookingId);
                assertTransition(booking.paymentStatus, 'FAILED');
                await prisma.booking.update({
                    where: { id: bookingId },
                    data: { paymentStatus: 'FAILED' }
                });
                await rollbackInitiatedBooking(booking);
                return res.status(400).json({ error: 'Payment verification failed' });
            }

            // 6. Re-fetch order from Razorpay to verify amount (defense in depth)
            const rzpOrder = await getRazorpay().orders.fetch(razorpay_order_id);

            // 7. Verify Amount (Critical)
            const paidAmount = rzpOrder.amount_paid ? Number(rzpOrder.amount_paid) / 100 : Number(rzpOrder.amount) / 100;
            if (Math.abs(paidAmount - booking.finalAmount) > 1) {
                console.error(`[Payments] Amount mismatch: Paid ${paidAmount}, Expected ${booking.finalAmount}`);
                assertTransition(booking.paymentStatus, 'FAILED');
                await prisma.booking.update({
                    where: { id: bookingId },
                    data: { paymentStatus: 'FAILED' }
                });
                await rollbackInitiatedBooking(booking);
                return res.status(400).json({ error: 'Amount mismatch' });
            }

            // Notes check: warn only
            if (rzpOrder.notes?.bookingId && rzpOrder.notes.bookingId !== bookingId) {
                console.warn('[Payments] WARN: Booking ID mismatch in order notes. Expected:', bookingId, 'Got:', rzpOrder.notes.bookingId);
            }

            // 8. Mark as AUTHORIZED (payment is secured)
            assertTransition(booking.paymentStatus, 'AUTHORIZED');
            await prisma.booking.update({
                where: { id: bookingId },
                data: {
                    paymentStatus: 'AUTHORIZED',
                    razorpayPaymentId: razorpay_payment_id,
                    paidAt: new Date()
                }
            });

            console.log('[Payments] Payment AUTHORIZED for booking:', bookingId);
        } else {
            console.log('[Payments] Booking already AUTHORIZED (webhook arrived first), proceeding to partner booking:', bookingId);
        }

        // 7. Try to create partner booking
        try {
            const partnerResult = await createHealthiansBooking(booking, userId, booking.slotTime);

            // 8. Success - update to CONFIRMED in transaction
            const currentStatus = alreadyAuthorized ? 'AUTHORIZED' : 'AUTHORIZED';
            assertTransition(currentStatus as any, 'CONFIRMED');
            await prisma.$transaction(async (tx) => {
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

            // Award referral bonus (non-blocking)
            tryAwardFirstOrderBonus(userId, bookingId).catch(err =>
                console.error('[Payments] First-order referral bonus failed:', err.message)
            );

            return res.json({ status: 'confirmed', bookingId });

        } catch (partnerError: any) {
            // 9. Partner failed - payment is secure, enqueue for retry
            console.error('[Payments] Partner booking failed:', partnerError.message);

            assertTransition('AUTHORIZED' as any, 'PARTNER_FAILED');
            await prisma.booking.update({
                where: { id: bookingId },
                data: {
                    paymentStatus: 'PARTNER_FAILED',
                    partnerError: partnerError.message || 'Healthians API failed'
                }
            });

            // Enqueue for automatic retry (exponential backoff)
            await prisma.partnerRetry.upsert({
                where: { bookingId },
                create: { bookingId, nextRetryAt: new Date(Date.now() + 60_000), lastError: partnerError.message },
                update: {}
            });

            return res.status(200).json({
                status: 'payment_received_booking_pending',
                bookingId,
                message: 'Payment received. Your booking is being processed and you will receive confirmation shortly.'
            });
        }

    } catch (error) {
        console.error('[Payments] Verify error:', error);
        res.status(500).json({ error: 'Payment verification failed' });
    }
});

// ============================================
// Helper: Create Healthians Booking
// ============================================
// ============================================
// Helper: Create Healthians Booking
// ============================================
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
        // BookingItem might not have the full patient object if not included, so we might need to fetch if missing
        // However, standard flow ensures we pass it. If 'patient' is missing on item, we likely need to fetch it.
        // But for optimization, let's assume caller includes it, or we fetch it here.

        // Robustness: If item.patient is missing, we must fetch it.
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
        slot: { slot_id: slotId || booking.slotTime },
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

    // NOTE: BookingItems are ALREADY created in the /initiate transaction.
    // We do NOT re-create them here.

    return response;
}

// ============================================
// POST /api/payments/webhook
// Handles Razorpay webhooks (backup for verify)
// NOTE: This must be mounted BEFORE express.json()
// ============================================
export const webhookHandler = async (req: Request, res: Response) => {
    const signature = req.headers['x-razorpay-signature'] as string;

    if (!signature) {
        return res.status(401).json({ error: 'Missing signature' });
    }

    // 1. Verify webhook signature (using raw body)
    const isValid = Razorpay.validateWebhookSignature(
        req.body.toString(),
        signature,
        process.env.RAZORPAY_WEBHOOK_SECRET!
    );

    if (!isValid) {
        console.error('[Webhook] Invalid signature');
        return res.status(401).end();
    }

    const payload = JSON.parse(req.body.toString());
    console.log('[Webhook] Full Payload:', JSON.stringify(payload, null, 2));

    // Prioritize header for event ID, fall back to payload
    const eventId = (req.headers['x-razorpay-event-id'] as string) || payload.event_id || payload.id;
    const event = payload.event;

    if (!eventId) {
        console.error('[Webhook] Error: x-razorpay-event-id header missing in headers and payload');
        return res.status(400).json({ error: 'event_id missing' });
    }

    console.log('[Webhook] Received:', event, eventId);

    // 2. Dedup check using WebhookEvent
    try {
        await prisma.webhookEvent.create({
            data: { eventId }
        });
    } catch (e: any) {
        if (e.code === 'P2002') {  // Unique constraint violation
            console.log('[Webhook] Duplicate event ignored:', eventId);
            return res.status(200).json({ status: 'duplicate' });
        }
        throw e;
    }

    // 3. Process event
    const payment = payload.payload.payment.entity;
    const orderId = payment.order_id;

    if (event === 'payment.captured') {
        const booking = await prisma.booking.findFirst({
            where: { razorpayOrderId: orderId }
        });

        if (booking && booking.paymentStatus === 'INITIATED') {
            console.log('[Webhook] Processing payment for booking:', booking.id);
            assertTransition(booking.paymentStatus, 'AUTHORIZED');
            await prisma.booking.update({
                where: { id: booking.id },
                data: {
                    paymentStatus: 'AUTHORIZED',
                    razorpayPaymentId: payment.id,
                    paidAt: new Date()
                }
            });

            // Step 10: Schedule delayed partner booking fallback
            // If /verify doesn't handle it within 60s, we trigger partner booking here.
            // This is faster than waiting for the reconciler's 5-min cycle.
            const bookingIdForDelay = booking.id;
            const userIdForDelay = booking.userId;
            setTimeout(async () => {
                try {
                    const freshBooking = await prisma.booking.findUnique({
                        where: { id: bookingIdForDelay },
                        include: { items: { include: { patient: true } } }
                    });
                    if (freshBooking && freshBooking.paymentStatus === 'AUTHORIZED' && !freshBooking.partnerBookingId) {
                        console.log('[Webhook] /verify did not complete, triggering partner booking for:', bookingIdForDelay);

                        const partnerResult = await createHealthiansBooking(freshBooking, userIdForDelay, freshBooking.slotTime);

                        assertTransition('AUTHORIZED' as any, 'CONFIRMED');
                        await prisma.$transaction(async (tx) => {
                            await tx.booking.update({
                                where: { id: bookingIdForDelay },
                                data: {
                                    paymentStatus: 'CONFIRMED',
                                    partnerBookingId: partnerResult.booking_id?.toString() || null,
                                    status: 'Order Booked'
                                }
                            });
                            await tx.cartItem.deleteMany({ where: { cart: { userId: userIdForDelay } } });
                        });
                        console.log('[Webhook] Delayed partner booking SUCCESS:', bookingIdForDelay);

                        // Award referral bonus (non-blocking)
                        tryAwardFirstOrderBonus(userIdForDelay, bookingIdForDelay).catch(err =>
                            console.error('[Webhook] First-order referral bonus failed:', err.message)
                        );
                    }
                } catch (delayErr: any) {
                    console.error('[Webhook] Delayed partner booking failed:', delayErr.message);
                    // The reconciler cron will pick this up on the next cycle
                }
            }, 60_000);
        }
    } else if (event === 'payment.failed') {
        const booking = await prisma.booking.findFirst({
            where: { razorpayOrderId: orderId }
        });

        if (booking && booking.paymentStatus === 'INITIATED') {
            console.log('[Webhook] Payment failed for booking:', booking.id);
            assertTransition(booking.paymentStatus, 'FAILED');
            await prisma.booking.update({
                where: { id: booking.id },
                data: { paymentStatus: 'FAILED' }
            });
            await rollbackInitiatedBooking(booking);
        }
    }

    res.status(200).json({ status: 'ok' });
};

// ============================================
// Helper: Rollback Initiated Booking (Promo/Wallet)
// ============================================
export async function rollbackInitiatedBooking(booking: any) {
    if (!booking) return;

    try {
        console.log('[Payments] Rolling back booking:', booking.id);

        await prisma.$transaction(async (tx) => {
            // 1. Rollback Promo 
            if (booking.promoCodeId) {
                const redemption = await tx.promoRedemption.findUnique({
                    where: { bookingId: booking.id }
                });

                if (redemption) {
                    await tx.promoRedemption.delete({ where: { id: redemption.id } });

                    const updateResult = await tx.promoCode.updateMany({
                        where: { id: booking.promoCodeId, redeemedCount: { gt: 0 } },
                        data: { redeemedCount: { decrement: 1 } }
                    });

                    if (updateResult.count > 0) {
                        console.log('[Payments] Promo usage rolled back');
                    } else {
                        console.warn('[Payments] Rollback Warning: Promo redeemedCount was 0 or ID not found, skipped decrement');
                    }
                }
            }

            // 2. Rollback Wallet
            if (booking.walletAmount > 0 && booking.userId) {
                const existingRefund = await tx.walletLedger.findFirst({
                    where: {
                        referenceId: booking.id,
                        referenceType: 'REFUND'
                    }
                });

                if (!existingRefund) {
                    const userWallet = await tx.wallet.findUnique({ where: { userId: booking.userId } });
                    if (userWallet) {
                        await tx.wallet.update({
                            where: { id: userWallet.id },
                            data: { balance: { increment: booking.walletAmount } }
                        });

                        await tx.walletLedger.create({
                            data: {
                                walletId: userWallet.id,
                                type: 'CREDIT',
                                amount: booking.walletAmount,
                                // Note: balanceAfter is approximate — read-time snapshot.
                                // Acceptable for audit trail; actual balance is source of truth.
                                balanceAfter: userWallet.balance + booking.walletAmount,
                                description: `Refund for booking #${booking.id.slice(0, 8)}`,
                                referenceType: 'REFUND',
                                referenceId: booking.id
                            }
                        });
                        console.log('[Payments] Wallet refunded');
                    }
                }
            }
        });
    } catch (error) {
        console.error('[Payments] Rollback failed:', error);
    }
}

export default router;
