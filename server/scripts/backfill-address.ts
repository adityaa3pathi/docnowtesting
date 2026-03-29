/**
 * Backfill Script: Populate addressId AND snapshot fields on legacy bookings
 *
 * This script does two things:
 * 1. Finds Booking records with null addressId and assigns the user's
 *    most recently created address.
 * 2. Finds Booking records with null snapshot fields (addressLine, etc.)
 *    and populates them from the linked Address row.
 *
 * Bookings whose users have no addresses at all are flagged for manual review.
 *
 * Usage:
 *   npx ts-node scripts/backfill-address.ts
 *
 * Run this BEFORE applying the Prisma migration that makes
 * Booking.addressId non-nullable.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('=== Backfill Booking.addressId + Address Snapshots ===\n');

    // ─── Phase 1: Backfill null addressId ───────────────────────────────

    const bookingsWithoutAddress = await prisma.booking.findMany({
        where: { addressId: null as any },
        select: { id: true, userId: true, createdAt: true }
    });

    console.log(`Phase 1: Found ${bookingsWithoutAddress.length} booking(s) without addressId.\n`);

    // Cache user → latest address to avoid repeated queries
    const addressCache = new Map<string, string | null>();
    const manualReview: string[] = [];
    let updatedPhase1 = 0;

    for (const booking of bookingsWithoutAddress) {
        let addressId = addressCache.get(booking.userId);

        if (addressId === undefined) {
            const latestAddress = await prisma.address.findFirst({
                where: { userId: booking.userId },
                orderBy: { id: 'desc' },
                select: { id: true }
            });

            addressId = latestAddress?.id ?? null;
            addressCache.set(booking.userId, addressId);
        }

        if (!addressId) {
            console.warn(`  ⚠ Booking ${booking.id} (user ${booking.userId}) — user has NO addresses. Flagged for manual review.`);
            manualReview.push(booking.id);
            continue;
        }

        await prisma.booking.update({
            where: { id: booking.id },
            data: { addressId }
        });

        updatedPhase1++;
        console.log(`  ✓ Booking ${booking.id} → addressId ${addressId}`);
    }

    console.log(`\nPhase 1 complete: ${updatedPhase1} updated, ${manualReview.length} need manual review.\n`);

    // ─── Phase 2: Backfill snapshot fields ──────────────────────────────

    const bookingsMissingSnapshot = await prisma.booking.findMany({
        where: {
            addressId: { not: null as any },
            addressLine: null
        },
        select: { id: true, addressId: true }
    });

    console.log(`Phase 2: Found ${bookingsMissingSnapshot.length} booking(s) with addressId but missing snapshot fields.\n`);

    // Cache addressId → address details
    const snapshotCache = new Map<string, { line1: string; city: string; pincode: string; lat: string | null; long: string | null } | null>();
    let updatedPhase2 = 0;

    for (const booking of bookingsMissingSnapshot) {
        if (!booking.addressId) continue;

        let addressData = snapshotCache.get(booking.addressId);

        if (addressData === undefined) {
            const addr = await prisma.address.findUnique({
                where: { id: booking.addressId },
                select: { line1: true, city: true, pincode: true, lat: true, long: true }
            });

            addressData = addr ?? null;
            snapshotCache.set(booking.addressId, addressData);
        }

        if (!addressData) {
            console.warn(`  ⚠ Booking ${booking.id} — addressId ${booking.addressId} not found in DB. Skipping.`);
            continue;
        }

        await prisma.booking.update({
            where: { id: booking.id },
            data: {
                addressLine: addressData.line1,
                addressCity: addressData.city,
                addressPincode: addressData.pincode,
                addressLat: addressData.lat,
                addressLong: addressData.long
            }
        });

        updatedPhase2++;
        console.log(`  ✓ Booking ${booking.id} → snapshot from address ${booking.addressId}`);
    }

    console.log(`\nPhase 2 complete: ${updatedPhase2} snapshots populated.\n`);

    // ─── Summary ────────────────────────────────────────────────────────

    console.log('=== Final Summary ===');
    console.log(`  Phase 1 (addressId):  ${updatedPhase1} updated`);
    console.log(`  Phase 2 (snapshots):  ${updatedPhase2} updated`);
    console.log(`  Manual review:        ${manualReview.length}`);

    if (manualReview.length > 0) {
        console.log(`\n  Booking IDs needing manual review:`);
        manualReview.forEach(id => console.log(`    - ${id}`));
    }

    console.log('\nDone.');
}

main()
    .catch((e) => {
        console.error('Backfill failed:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
