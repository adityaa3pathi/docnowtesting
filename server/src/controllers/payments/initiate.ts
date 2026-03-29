import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getRazorpay } from '../../services/razorpay';
import { createHealthiansBooking } from '../../services/partnerBooking';
import { rollbackInitiatedBooking } from '../../services/rollback';
import { calculateDiscount } from '../../utils/promoHelper';
import { assertTransition } from '../../utils/paymentStateMachine';
import { tryAwardFirstOrderBonus } from '../../utils/referralService';

/**
 * POST /api/payments/initiate
 * Creates Booking + Locks Promo + Deducts Wallet + Creates Razorpay Order
 */
export const initiatePayment = async (req: AuthRequest, res: Response) => {
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

        // 1. Fetch Prerequisites (User, Address)
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
        const { booking, finalAmount } = await prisma.$transaction(async (tx) => {
            // A. Read cart inside tx — prevents TOCTOU
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

                // Per-user limit check
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
                }
            }

            // D. Resolve "self" patient for items without explicit patientId
            let selfPatientId: string | null = null;
            const hasNullPatient = cart.items.some(item => !item.patientId);

            if (hasNullPatient) {
                let selfPatient = await tx.patient.findFirst({
                    where: { userId, relation: { in: ['Self', 'self'] } }
                });

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
                    addressLine: address.line1,
                    addressCity: address.city,
                    addressPincode: address.pincode,
                    addressLat: address.lat,
                    addressLong: address.long,
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

            // Link Promo Redemption
            if (promoCodeId) {
                await tx.promoRedemption.create({
                    data: { userId, promoCodeId, bookingId: newBooking.id }
                });
            }

            // Wallet Ledger Entry
            if (walletAmount > 0 && user.wallet) {
                const updatedWallet = await tx.wallet.findUnique({ where: { id: user.wallet.id } });
                await tx.walletLedger.create({
                    data: {
                        walletId: user.wallet.id,
                        type: 'DEBIT',
                        amount: -walletAmount,
                        balanceAfter: updatedWallet!.balance,
                        description: `Used for booking #${newBooking.id.slice(0, 8)}`,
                        referenceType: 'ORDER',
                        referenceId: newBooking.id
                    }
                });
            }

            // Zero-amount path
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

        // OUTSIDE TRANSACTION: Razorpay order creation
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
                await prisma.cartItem.deleteMany({ where: { cart: { userId } } });

                tryAwardFirstOrderBonus(userId, booking.id).catch(err =>
                    console.error('[Payments] First-order referral bonus failed:', err.message)
                );

                return res.json({ bookingId: booking.id, status: 'confirmed', amount: 0 });
            } catch (error) {
                console.error('[Payments] Partner booking failed for zero amount:', error);
                assertTransition('PAID' as any, 'PARTNER_FAILED' as any);
                await prisma.booking.update({
                    where: { id: booking.id },
                    data: { paymentStatus: 'PARTNER_FAILED', partnerError: (error as Error).message || 'Partner API failed' }
                });
                await prisma.partnerRetry.upsert({
                    where: { bookingId: booking.id },
                    create: { bookingId: booking.id, nextRetryAt: new Date(Date.now() + 60_000), lastError: (error as Error).message },
                    update: {}
                });
                await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
                return res.json({ bookingId: booking.id, status: 'payment_received_booking_pending', amount: 0 });
            }
        }

        return res.status(500).json({ error: 'Unexpected flow' });

    } catch (error: any) {
        console.error('[Payments] Initiate Error:', error);

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
};
