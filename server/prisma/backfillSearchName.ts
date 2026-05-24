/**
 * backfillSearchName.ts — One-time migration script to populate the `searchName`
 * column on all existing CatalogItem rows.
 *
 * Usage:
 *   npx ts-node prisma/backfillSearchName.ts
 *
 * Or via tsx:
 *   npx tsx prisma/backfillSearchName.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeSearchTerm(input: string): string {
    if (!input) return '';
    return input.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function backfill() {
    console.log('[Backfill] Starting searchName backfill...');

    const items = await prisma.catalogItem.findMany({
        select: { id: true, name: true, searchName: true },
    });

    console.log(`[Backfill] Found ${items.length} catalog items.`);

    const BATCH_SIZE = 100;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);

        const updates = batch
            .map(item => {
                const newSearchName = normalizeSearchTerm(item.name);
                // Skip if already correct
                if (item.searchName === newSearchName) {
                    skipped++;
                    return null;
                }
                return prisma.catalogItem.update({
                    where: { id: item.id },
                    data: { searchName: newSearchName },
                });
            })
            .filter(Boolean) as any[];

        if (updates.length > 0) {
            await prisma.$transaction(updates);
            updated += updates.length;
        }

        console.log(`[Backfill] Progress: ${Math.min(i + BATCH_SIZE, items.length)}/${items.length} (updated: ${updated}, skipped: ${skipped})`);
    }

    console.log(`[Backfill] Complete! Updated: ${updated}, Skipped: ${skipped}, Total: ${items.length}`);
}

backfill()
    .catch((error) => {
        console.error('[Backfill] Error:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
