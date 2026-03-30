/**
 * Replay Report Webhook
 *
 * Simulates a report_uploaded webhook by calling the exact same service
 * functions that production uses. No HTTP/webhook secret needed.
 *
 * Usage:
 *   npx ts-node scripts/replay-report-webhook.ts \
 *     --bookingId <partnerBookingId> \
 *     --reportUrl <any-pdf-url> \
 *     --vendorCustomerId <id> \
 *     --fullReport 1
 *
 * Example with a test PDF:
 *   npx ts-node scripts/replay-report-webhook.ts \
 *     --bookingId 22477500 \
 *     --reportUrl "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" \
 *     --vendorCustomerId "test-customer-1" \
 *     --fullReport 1
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { handleReportUploaded } from '../src/services/healthiansWebhook';
import { ingestReport } from '../src/services/reportIngestion';

const prisma = new PrismaClient();

async function main() {
    const args = parseArgs();

    console.log('=== Replay Report Webhook ===');
    console.log('Partner Booking ID:', args.bookingId);
    console.log('Report URL:', args.reportUrl);
    console.log('Vendor Customer ID:', args.vendorCustomerId);
    console.log('Full Report:', args.fullReport);
    console.log('');

    // Step 1: Find the booking
    const booking = await prisma.booking.findFirst({
        where: { partnerBookingId: args.bookingId },
        select: { id: true },
    });

    if (!booking) {
        console.error(`❌ No booking found with partnerBookingId: ${args.bookingId}`);
        console.log('\nAvailable bookings:');
        const bookings = await prisma.booking.findMany({
            select: { id: true, partnerBookingId: true, status: true },
            take: 10,
            orderBy: { createdAt: 'desc' },
        });
        bookings.forEach(b =>
            console.log(`  ${b.partnerBookingId || '(none)'} → ${b.id} [${b.status}]`)
        );
        process.exit(1);
    }

    console.log(`✓ Found booking: ${booking.id}`);

    // Step 2: Call handleReportUploaded inside a transaction (same as webhook)
    const webhookData = {
        verified_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        report_url: args.reportUrl,
        full_report: args.fullReport ? 1 : 0,
        vendor_customer_id: args.vendorCustomerId,
    };

    let reportId: string = '';

    await prisma.$transaction(async (tx) => {
        reportId = await handleReportUploaded(tx, booking, webhookData);
    });

    console.log(`✓ Report row created/updated: ${reportId}`);

    // Step 3: Verify the DB row
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    console.log('\nReport row:');
    console.log(JSON.stringify(report, null, 2));

    // Step 4: Trigger ingestion
    console.log('\n--- Starting ingestion ---');
    await ingestReport(reportId);

    // Step 5: Verify final state
    const finalReport = await prisma.report.findUnique({ where: { id: reportId } });
    console.log('\nFinal report state:');
    console.log(JSON.stringify(finalReport, null, 2));

    if (finalReport?.fetchStatus === 'STORED') {
        console.log(`\n✅ SUCCESS! Report stored at: ${finalReport.storageKey}`);
        console.log(`   File size: ${finalReport.fileSize} bytes`);
        console.log(`   Download: GET /api/reports/${reportId}/download`);
    } else {
        console.log(`\n⚠️  Report status: ${finalReport?.fetchStatus}`);
        if (finalReport?.fetchError) {
            console.log(`   Error: ${finalReport.fetchError}`);
        }
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed: Record<string, string> = {};

    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        parsed[key] = args[i + 1] || '';
    }

    if (!parsed.bookingId || !parsed.reportUrl) {
        console.error('Usage: npx ts-node scripts/replay-report-webhook.ts \\');
        console.error('  --bookingId <partnerBookingId> \\');
        console.error('  --reportUrl <pdf-url> \\');
        console.error('  --vendorCustomerId <id> \\');
        console.error('  --fullReport <0|1>');
        process.exit(1);
    }

    return {
        bookingId: parsed.bookingId,
        reportUrl: parsed.reportUrl,
        vendorCustomerId: parsed.vendorCustomerId || 'test-customer',
        fullReport: parsed.fullReport === '1',
    };
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
