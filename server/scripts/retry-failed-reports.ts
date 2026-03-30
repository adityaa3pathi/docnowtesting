/**
 * Retry Failed Reports
 *
 * Finds all reports with fetchStatus=FAILED and retries ingestion.
 * Uses getCustomerReport_v2 API to get fresh signed URLs.
 *
 * Usage:
 *   npx ts-node scripts/retry-failed-reports.ts
 *   npx ts-node scripts/retry-failed-reports.ts --dry-run   # list only, don't retry
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { ingestReport } from '../src/services/reportIngestion';

const prisma = new PrismaClient();

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    console.log(`=== Retry Failed Reports ${dryRun ? '(DRY RUN)' : ''} ===\n`);

    const failedReports = await prisma.report.findMany({
        where: { fetchStatus: 'FAILED' },
        include: {
            booking: {
                select: {
                    partnerBookingId: true,
                    userId: true,
                },
            },
        },
        orderBy: { generatedAt: 'desc' },
    });

    if (failedReports.length === 0) {
        console.log('✅ No failed reports found. All clear!');
        return;
    }

    console.log(`Found ${failedReports.length} failed report(s):\n`);

    for (const report of failedReports) {
        console.log(`  Report: ${report.id}`);
        console.log(`  Booking: ${report.booking?.partnerBookingId || report.bookingId}`);
        console.log(`  Customer: ${report.vendorCustomerId || '(none)'}`);
        console.log(`  Error: ${report.fetchError || '(unknown)'}`);
        console.log(`  Created: ${report.generatedAt.toISOString()}`);

        if (!dryRun) {
            console.log('  → Retrying...');
            try {
                // Reset to PENDING so ingestion will attempt again
                await prisma.report.update({
                    where: { id: report.id },
                    data: { fetchStatus: 'PENDING', fetchError: null },
                });

                await ingestReport(report.id);

                const updated = await prisma.report.findUnique({ where: { id: report.id } });
                if (updated?.fetchStatus === 'STORED') {
                    console.log(`  ✅ SUCCESS! Stored at ${updated.storageKey}`);
                } else {
                    console.log(`  ⚠️  Still ${updated?.fetchStatus}: ${updated?.fetchError}`);
                }
            } catch (err: any) {
                console.error(`  ❌ Retry failed: ${err.message}`);
            }
        }

        console.log('');
    }

    // Summary
    if (!dryRun) {
        const stored = await prisma.report.count({ where: { fetchStatus: 'STORED' } });
        const failed = await prisma.report.count({ where: { fetchStatus: 'FAILED' } });
        const pending = await prisma.report.count({ where: { fetchStatus: 'PENDING' } });
        console.log(`\n--- Summary ---`);
        console.log(`STORED: ${stored}  |  PENDING: ${pending}  |  FAILED: ${failed}`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
