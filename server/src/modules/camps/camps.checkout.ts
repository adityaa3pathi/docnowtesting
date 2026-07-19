/**
 * Camp Checkout Handler
 * 
 * POST /api/camps/checkout
 * 
 * Creates a Booking for a camp registration, handles promo codes,
 * wallet deductions, and Razorpay order creation.
 * 
 * Modelled after the home-collection initiate.ts but with key differences:
 * - No slot_id or addressId required (camp has fixed location & dates)
 * - Price comes from Camp.price (no collection fee)
 * - Items derived from CampCatalogItem, not user's cart
 * - Single patientId for all items
 * - DOB is collected and saved to Patient
 */
import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getRazorpay } from '../../services/razorpay';
import { rollbackInitiatedBooking } from '../../services/rollback';
import { calculateDiscount } from '../../utils/promoHelper';
import { assertTransition } from '../../utils/paymentStateMachine';
import { tryAwardFirstOrderBonus } from '../../utils/referralService';
import { finalizeBooking } from '../../services/bookingFinalization';
import { logAlert, logBusinessEvent, logger } from '../../utils/logger';
import { campCheckoutSchema } from './camps.types';

export const initiateCampCheckout = async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const idempotencyKey = (req.headers['x-idempotency-key'] as string) || req.body.idempotencyKey;

    // Validate request body
    const parse = campCheckoutSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({
            error: parse.error.issues[0].message,
            code: 'VALIDATION_ERROR',
        });
    }

    const { campId, patientId, dob, promoCode: rawPromoCode, useWallet } = parse.data;
    const promoCode = rawPromoCode ? rawPromoCode.trim().toUpperCase() : undefined;

    try {
        // 0. Idempotency: Return existing booking if key matches
        if (idempotencyKey) {
            const existing = await prisma.booking.findUnique({
                where: { idempotencyKey },
            });
            if (existing && ['INITIATED', 'AUTHORIZED', 'CONFIRMED', 'PAID'].includes(existing.paymentStatus)) {
                logBusinessEvent('camp_checkout_idempotent_hit', {
                    bookingId: existing.id,
                    paymentStatus: existing.paymentStatus,
                }, 'debug');
                return res.json({
                    bookingId: existing.id,
                    razorpayOrderId: existing.razorpayOrderId,
                    amount: existing.finalAmount * 100,
                    currency: 'INR',
                    keyId: process.env.RAZORPAY_KEY_ID,
                    idempotent: true,
                });
            }
        }

        // 1. Fetch Prerequisites
        const [user, camp] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } }),
            prisma.camp.findUnique({
                where: { id: campId },
                include: {
                    items: {
                        include: {
                            catalogItem: {
                                select: { id: true, partnerCode: true, name: true, isEnabled: true },
                            },
                        },
                    },
                },
            }),
        ]);

        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!camp) return res.status(404).json({ error: 'Camp not found' });
        if (!camp.isActive) return res.status(400).json({ error: 'This camp is no longer active', code: 'CAMP_INACTIVE' });
        if (new Date() > camp.endDate) return res.status(400).json({ error: 'This camp has ended', code: 'CAMP_ENDED' });
        if (camp.items.length === 0) return res.status(400).json({ error: 'This camp has no tests configured' });

        // Validate profile completeness
        if (!user.name || !user.gender || !user.age) {
            return res.status(400).json({
                error: 'Profile incomplete',
                code: 'PROFILE_INCOMPLETE',
                missingFields: { name: !user.name, gender: !user.gender, age: !user.age },
            });
        }

        // Check for disabled catalog items
        const disabledItems = camp.items.filter(item => !item.catalogItem.isEnabled);
        if (disabledItems.length > 0) {
            return res.status(400).json({
                error: 'Some tests in this camp are currently unavailable',
                code: 'DISABLED_ITEMS',
                disabledItems: disabledItems.map(i => ({ name: i.catalogItem.name })),
            });
        }

        // 2. Core Calculation & Transaction (NO network calls inside tx)
        const { booking, finalAmount } = await prisma.$transaction(async (tx) => {
            // A. Verify patient belongs to user
            const patient = await tx.patient.findFirst({
                where: { id: patientId, userId },
            });
            if (!patient) throw new Error('Patient not found or does not belong to user');

            // B. Save DOB to patient if not already set
            if (!patient.dob) {
                await tx.patient.update({
                    where: { id: patientId },
                    data: { dob: new Date(dob) },
                });
            }

            // C. Calculate pricing
            const totalAmount = camp.price;
            let discountAmount = 0;
            let walletAmount = 0;
            let promoCodeId: string | null = null;

            // D. Promo Code Logic (Atomic — same pattern as initiate.ts)
            if (promoCode) {
                const promo = await tx.promoCode.findUnique({ where: { code: promoCode } });

                if (!promo || !promo.isActive) throw new Error('Invalid or inactive promo code');
                if (promo.expiresAt && new Date() > promo.expiresAt) throw new Error('Promo code expired');
                if (new Date() < promo.startsAt) throw new Error('Promo code not yet active');
                if (totalAmount < promo.minOrderValue) throw new Error(`Minimum order value of ₹${promo.minOrderValue} required`);

                // Per-user limit check
                const existingRedemption = await tx.promoRedemption.findFirst({
                    where: { userId, promoCodeId: promo.id },
                });
                if (existingRedemption) throw new Error('You have already used this promo code');

                // Atomic Increment & Check Limit
                if (promo.maxRedemptions !== null) {
                    const result = await tx.promoCode.updateMany({
                        where: {
                            id: promo.id,
                            redeemedCount: { lt: promo.maxRedemptions },
                        },
                        data: { redeemedCount: { increment: 1 } },
                    });
                    if (result.count === 0) throw new Error('Promo usage limit reached');
                } else {
                    await tx.promoCode.update({
                        where: { id: promo.id },
                        data: { redeemedCount: { increment: 1 } },
                    });
                }

                discountAmount = calculateDiscount(promo, totalAmount);
                promoCodeId = promo.id;
            }

            // E. Wallet Logic (Atomic — same pattern as initiate.ts)
            if (useWallet && user.wallet) {
                const payableAfterDiscount = totalAmount - discountAmount;
                const walletBalance = user.wallet.balance;
                const amountToDeduct = Math.min(walletBalance, payableAfterDiscount);

                if (amountToDeduct > 0) {
                    const result = await tx.wallet.updateMany({
                        where: {
                            id: user.wallet.id,
                            balance: { gte: amountToDeduct },
                        },
                        data: { balance: { decrement: amountToDeduct } },
                    });

                    if (result.count === 0) throw new Error('Insufficient wallet balance during processing');
                    walletAmount = amountToDeduct;
                }
            }

            // F. Create Booking
            const finalAmount = Math.max(0, totalAmount - discountAmount - walletAmount);
            const campSlotDate = camp.startDate.toISOString().split('T')[0];

            const newBooking = await tx.booking.create({
                data: {
                    userId,
                    campId: camp.id,
                    // No addressId — camp bookings don't need home address
                    // Store camp location as address snapshot for invoice
                    addressLine: camp.location,
                    addressCity: camp.city,
                    addressPincode: camp.pincode,
                    billingName: user.name,
                    billingGender: user.gender,
                    status: 'PENDING',
                    paymentStatus: 'INITIATED',
                    slotDate: campSlotDate,
                    slotTime: 'Camp',
                    totalAmount,
                    discountAmount,
                    walletAmount,
                    finalAmount,
                    promoCodeId,
                    idempotencyKey: idempotencyKey || undefined,
                    items: {
                        create: camp.items.map(campItem => ({
                            patientId,
                            testCode: campItem.catalogItem.partnerCode,
                            testName: campItem.catalogItem.name,
                            price: 0, // Individual items are priced at camp level
                        })),
                    },
                },
                include: { items: { include: { patient: true } } },
            });

            // Link Promo Redemption
            if (promoCodeId) {
                await tx.promoRedemption.create({
                    data: { userId, promoCodeId, bookingId: newBooking.id },
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
                        description: `Used for camp registration #${newBooking.id.slice(0, 8)}`,
                        referenceType: 'ORDER',
                        referenceId: newBooking.id,
                    },
                });
            }

            // Zero-amount path
            if (finalAmount === 0) {
                await tx.booking.update({
                    where: { id: newBooking.id },
                    data: {
                        paymentStatus: 'PAID',
                        razorpayPaymentId: `ZERO_${newBooking.id}`,
                        paidAt: new Date(),
                    },
                });
            }

            return { booking: newBooking, finalAmount, currency: 'INR' };
        }, {
            maxWait: 5000,
            timeout: 10000,
        });

        // OUTSIDE TRANSACTION: Razorpay order creation
        if (finalAmount > 0) {
            let razorpayOrder;
            try {
                razorpayOrder = await getRazorpay().orders.create({
                    amount: Math.round(finalAmount * 100),
                    currency: 'INR',
                    receipt: booking.id,
                    notes: { bookingId: booking.id, type: 'camp' },
                });

                await prisma.booking.update({
                    where: { id: booking.id },
                    data: { razorpayOrderId: razorpayOrder.id },
                });
            } catch (rzpError: any) {
                logAlert('razorpay_order_creation_failed_camp', {
                    error: rzpError,
                    bookingId: booking.id,
                    amount: finalAmount,
                });
                assertTransition('INITIATED' as any, 'FAILED' as any);
                await prisma.booking.update({
                    where: { id: booking.id },
                    data: { paymentStatus: 'FAILED' },
                });
                await rollbackInitiatedBooking(booking);
                return res.status(500).json({ error: 'Payment gateway error. Please try again.' });
            }

            logBusinessEvent('camp_checkout_initiated', {
                bookingId: booking.id,
                campId: camp.id,
                razorpayOrderId: razorpayOrder.id,
                amount: finalAmount,
            });

            return res.json({
                bookingId: booking.id,
                razorpayOrderId: razorpayOrder.id,
                amount: finalAmount * 100,
                currency: 'INR',
                keyId: process.env.RAZORPAY_KEY_ID,
            });
        }

        // Handle Zero Amount — Instant Confirmation
        if (finalAmount === 0) {
            logBusinessEvent('camp_zero_amount_booking_paid', { bookingId: booking.id, campId: camp.id });
            const result = await finalizeBooking(booking.id);

            if (result.status === 'success') {
                tryAwardFirstOrderBonus(userId, booking.id).catch(err =>
                    logger.warn({ error: err, bookingId: booking.id }, 'camp_first_order_referral_bonus_failed')
                );
                return res.json({ bookingId: booking.id, status: 'confirmed', amount: 0 });
            } else {
                return res.json({ bookingId: booking.id, status: 'payment_received_booking_pending', amount: 0 });
            }
        }

        return res.status(500).json({ error: 'Unexpected flow' });
    } catch (error: any) {
        logger.error({ error, userId, campId }, 'camp_checkout_failed');
        res.status(500).json({ error: error.message || 'Camp registration failed' });
    }
};
