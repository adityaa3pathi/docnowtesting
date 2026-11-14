/**
 * Real-Postgres test helpers. Suites run only when TEST_DATABASE_URL is set (see `npm run test:db`),
 * and only against a database whose name contains "test", because they truncate tables.
 */
import { PrismaClient } from '@prisma/client';
import { describe } from 'vitest';
import { randomInt, randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test"');
}

export const testDb = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);
export const describeDb = url ? describe : describe.skip;

/** Wipes everything a checkout touches. Catalog rows are left alone; each suite upserts its own. */
export async function resetCommerceData() {
    await testDb.$executeRawUnsafe(
        'TRUNCATE "WalletLedger", "Wallet", "PromoRedemption", "PromoCode", "BookingItem", "PartnerRetry", "Report", "Booking", "CartItem", "Cart", "Patient", "Address", "Session", "ReferralReward", "User" CASCADE',
    );
}

export async function makeUser(overrides: Partial<{ name: string; gender: string; age: number; email: string; role: 'USER' | 'MANAGER' | 'SUPER_ADMIN' }> = {}) {
    const mobile = `7${randomInt(100000000, 999999999)}`;
    return testDb.user.create({
        data: { mobile, name: overrides.name ?? `Test ${mobile}`, gender: overrides.gender ?? 'M', age: overrides.age ?? 30, email: overrides.email, role: overrides.role ?? 'USER' },
    });
}

export async function makeAddress(userId: string) {
    return testDb.address.create({ data: { userId, line1: '12 Test Road', city: 'Jaipur', pincode: '302001', lat: '26.9124', long: '75.7873' } });
}

export async function makeWallet(userId: string, balance: number) {
    return testDb.wallet.create({ data: { userId, balance } });
}

export async function makeCatalogItem(partnerCode: string, price: number, isEnabled = true) {
    return testDb.catalogItem.upsert({
        where: { partnerCode },
        update: { isEnabled, displayPrice: price },
        create: { partnerCode, name: `Test ${partnerCode}`, partnerPrice: price, displayPrice: price, isEnabled },
    });
}

/** A cart holding one catalog item, with the catalog row the checkout guard looks for. */
export async function makeCartWithItem(userId: string, opts: { testCode?: string; price?: number; enabled?: boolean } = {}) {
    const testCode = opts.testCode ?? `DEAL-${randomUUID().slice(0, 8)}`;
    const price = opts.price ?? 1000;
    await makeCatalogItem(testCode, price, opts.enabled ?? true);
    const cart = await testDb.cart.create({ data: { userId, items: { create: { testCode, testName: `Test ${testCode}`, price } } }, include: { items: true } });
    return { cart, testCode, price };
}

export async function makePromo(overrides: Partial<{ code: string; discountType: 'FLAT' | 'PERCENTAGE'; discountValue: number; maxDiscount: number; minOrderValue: number; maxRedemptions: number }> = {}) {
    return testDb.promoCode.create({
        data: {
            code: overrides.code ?? `PROMO${randomInt(100000, 999999)}`,
            discountType: (overrides.discountType ?? 'FLAT') as any,
            discountValue: overrides.discountValue ?? 100,
            maxDiscount: overrides.maxDiscount,
            minOrderValue: overrides.minOrderValue ?? 0,
            maxRedemptions: overrides.maxRedemptions,
        },
    });
}

export async function makePatient(userId: string) {
    return testDb.patient.create({ data: { userId, name: 'Test Patient', relation: 'SELF', age: 30, gender: 'F' } });
}

/** A booking already past checkout, as pay-on-collection or online. */
export async function makeBooking(input: {
    userId: string;
    addressId?: string;
    paymentMethod?: 'ONLINE' | 'PAY_ON_COLLECTION';
    paymentStatus?: 'INITIATED' | 'PAID' | 'CONFIRMED' | 'PROCESSING';
    status?: string;
    totalAmount?: number;
    finalAmount?: number;
    discountAmount?: number;
    walletAmount?: number;
    razorpayPaymentId?: string | null;
    promoCodeId?: string | null;
    collectedAt?: Date | null;
    collectedAmount?: number | null;
    partnerBookingId?: string | null;
    createdAt?: Date;
    items?: { testCode: string; testName: string; price: number; patientId: string }[];
}) {
    const method = input.paymentMethod ?? 'ONLINE';
    const final = input.finalAmount ?? 1000;
    // Checkout snapshots the address onto the booking; tests that read it need the same copy.
    const address = input.addressId ? await testDb.address.findUnique({ where: { id: input.addressId } }) : null;
    return testDb.booking.create({
        data: {
            userId: input.userId,
            addressId: input.addressId,
            addressLine: address?.line1,
            addressCity: address?.city,
            addressPincode: address?.pincode,
            status: input.status ?? 'CONFIRMED',
            paymentStatus: (input.paymentStatus ?? 'CONFIRMED') as any,
            paymentMethod: method,
            slotDate: new Date().toISOString().split('T')[0],
            slotTime: '10:00 AM - 11:00 AM',
            totalAmount: input.totalAmount ?? final,
            discountAmount: input.discountAmount ?? 0,
            walletAmount: input.walletAmount ?? 0,
            finalAmount: final,
            razorpayPaymentId: input.razorpayPaymentId === undefined
                ? (method === 'PAY_ON_COLLECTION' ? `COD_${randomUUID()}` : `pay_${randomUUID().slice(0, 14)}`)
                : input.razorpayPaymentId,
            promoCodeId: input.promoCodeId ?? undefined,
            collectedAt: input.collectedAt ?? undefined,
            collectedAmount: input.collectedAmount ?? undefined,
            partnerBookingId: input.partnerBookingId ?? undefined,
            createdAt: input.createdAt,
            items: input.items ? { create: input.items } : undefined,
        },
        include: { items: true },
    });
}
