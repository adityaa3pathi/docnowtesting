import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getClientIP } from '../../utils/adminHelpers';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ImportRow {
    id: string;
    displayPrice: string | number;
    discountedPrice?: string | number | null;
}

interface ValidationError {
    row: number;
    id: string;
    field: string;
    message: string;
}

interface PreviewItem {
    id: string;
    name: string;
    type: string;
    currentDisplayPrice: number;
    newDisplayPrice: number;
    currentDiscountedPrice: number | null;
    newDiscountedPrice: number | null;
    changed: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parsePrice(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = typeof value === 'number' ? value : parseFloat(String(value).trim());
    return isNaN(num) ? null : num;
}

// ─── Validate ───────────────────────────────────────────────────────────────

/**
 * POST /api/manager/catalog/import/validate
 *
 * Accepts parsed CSV rows, validates them against the database, and returns
 * a preview of changes without making any mutations.
 */
export async function validateCatalogImport(req: AuthRequest, res: Response) {
    try {
        const { rows } = req.body as { rows: ImportRow[] };

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'No rows provided.' });
        }

        if (rows.length > 10000) {
            return res.status(400).json({ error: 'Too many rows. Maximum 10,000 allowed.' });
        }

        const errors: ValidationError[] = [];
        const validRows: { row: number; id: string; displayPrice: number; discountedPrice: number | null }[] = [];

        // ── Client-side validation ──────────────────────────────────────
        for (let i = 0; i < rows.length; i++) {
            const rowNum = i + 2; // +2 = 1-indexed + header row
            const row = rows[i];

            if (!row.id || typeof row.id !== 'string' || !row.id.trim()) {
                errors.push({ row: rowNum, id: row.id || '', field: 'Product ID', message: 'Product ID is required' });
                continue;
            }

            const dp = parsePrice(row.displayPrice);
            if (dp === null) {
                errors.push({ row: rowNum, id: row.id, field: 'Display Price', message: 'Must be a valid number' });
                continue;
            }
            if (dp < 0) {
                errors.push({ row: rowNum, id: row.id, field: 'Display Price', message: 'Must not be negative' });
                continue;
            }

            let disc: number | null = null;
            if (row.discountedPrice !== undefined && row.discountedPrice !== null && row.discountedPrice !== '') {
                disc = parsePrice(row.discountedPrice);
                if (disc === null) {
                    errors.push({ row: rowNum, id: row.id, field: 'Discounted Price', message: 'Must be a valid number or empty' });
                    continue;
                }
                if (disc < 0) {
                    errors.push({ row: rowNum, id: row.id, field: 'Discounted Price', message: 'Must not be negative' });
                    continue;
                }
                if (disc > dp) {
                    errors.push({ row: rowNum, id: row.id, field: 'Discounted Price', message: 'Must not exceed Display Price' });
                    continue;
                }
            }

            validRows.push({ row: rowNum, id: row.id.trim(), displayPrice: dp, discountedPrice: disc });
        }

        // ── Database lookup — single query ──────────────────────────────
        const uniqueIds = [...new Set(validRows.map(r => r.id))];
        const existingItems = await prisma.catalogItem.findMany({
            where: { id: { in: uniqueIds } },
            select: { id: true, name: true, type: true, displayPrice: true, discountedPrice: true },
        });
        const itemMap = new Map(existingItems.map(item => [item.id, item]));

        // ── Build preview ───────────────────────────────────────────────
        const preview: PreviewItem[] = [];
        const seenIds = new Set<string>();

        for (const vr of validRows) {
            // Handle duplicate IDs in CSV — last one wins
            if (seenIds.has(vr.id)) {
                // Remove previous entry, this one overwrites
                const idx = preview.findIndex(p => p.id === vr.id);
                if (idx !== -1) preview.splice(idx, 1);
            }
            seenIds.add(vr.id);

            const existing = itemMap.get(vr.id);
            if (!existing) {
                errors.push({ row: vr.row, id: vr.id, field: 'Product ID', message: 'Product not found in catalog' });
                continue;
            }

            const changed =
                existing.displayPrice !== vr.displayPrice ||
                (existing.discountedPrice ?? null) !== vr.discountedPrice;

            preview.push({
                id: existing.id,
                name: existing.name,
                type: existing.type,
                currentDisplayPrice: existing.displayPrice,
                newDisplayPrice: vr.displayPrice,
                currentDiscountedPrice: existing.discountedPrice,
                newDiscountedPrice: vr.discountedPrice,
                changed,
            });
        }

        const validUpdates = preview.filter(p => p.changed).length;
        const unchanged = preview.filter(p => !p.changed).length;

        res.json({
            summary: {
                totalRows: rows.length,
                validUpdates,
                unchanged,
                invalid: errors.length,
            },
            preview,
            errors,
        });
    } catch (error: any) {
        console.error('[CatalogBulk] Validation error:', error);
        res.status(500).json({ error: 'Failed to validate import', details: error.message });
    }
}

// ─── Execute ────────────────────────────────────────────────────────────────

/**
 * POST /api/manager/catalog/import/execute
 *
 * Accepts validated updates and executes them in batched database operations.
 * Creates an audit log entry for the bulk operation.
 */
export async function executeCatalogImport(req: AuthRequest, res: Response) {
    try {
        const { updates, filename } = req.body as {
            updates: Array<{ id: string; displayPrice: number; discountedPrice: number | null }>;
            filename: string;
        };

        if (!Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided.' });
        }

        if (updates.length > 10000) {
            return res.status(400).json({ error: 'Too many updates. Maximum 10,000 allowed.' });
        }

        // ── Re-validate server-side (defense-in-depth) ──────────────────
        const ids = updates.map(u => u.id);
        const existingItems = await prisma.catalogItem.findMany({
            where: { id: { in: ids } },
            select: { id: true, displayPrice: true, discountedPrice: true },
        });
        const itemMap = new Map(existingItems.map(item => [item.id, item]));

        const validUpdates: Array<{
            id: string;
            displayPrice: number;
            discountedPrice: number | null;
            prevDisplayPrice: number;
            prevDiscountedPrice: number | null;
        }> = [];
        const failedErrors: Array<{ id: string; message: string }> = [];

        for (const update of updates) {
            const existing = itemMap.get(update.id);
            if (!existing) {
                failedErrors.push({ id: update.id, message: 'Product not found' });
                continue;
            }
            if (typeof update.displayPrice !== 'number' || update.displayPrice < 0) {
                failedErrors.push({ id: update.id, message: 'Invalid display price' });
                continue;
            }
            if (update.discountedPrice !== null && (typeof update.discountedPrice !== 'number' || update.discountedPrice < 0)) {
                failedErrors.push({ id: update.id, message: 'Invalid discounted price' });
                continue;
            }

            // Skip unchanged
            if (
                existing.displayPrice === update.displayPrice &&
                (existing.discountedPrice ?? null) === update.discountedPrice
            ) {
                continue;
            }

            validUpdates.push({
                id: update.id,
                displayPrice: update.displayPrice,
                discountedPrice: update.discountedPrice,
                prevDisplayPrice: existing.displayPrice,
                prevDiscountedPrice: existing.discountedPrice,
            });
        }

        if (validUpdates.length === 0) {
            return res.json({
                success: 0,
                failed: failedErrors.length,
                errors: failedErrors,
                message: 'No changes to apply.',
            });
        }

        // ── Execute batched updates ─────────────────────────────────────
        const BATCH_SIZE = 50;
        let successCount = 0;

        for (let i = 0; i < validUpdates.length; i += BATCH_SIZE) {
            const batch = validUpdates.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(u =>
                    prisma.catalogItem.update({
                        where: { id: u.id },
                        data: {
                            displayPrice: u.displayPrice,
                            discountedPrice: u.discountedPrice,
                        },
                    })
                )
            );

            for (let j = 0; j < results.length; j++) {
                if (results[j].status === 'fulfilled') {
                    successCount++;
                } else {
                    failedErrors.push({
                        id: batch[j].id,
                        message: (results[j] as PromiseRejectedResult).reason?.message || 'Update failed',
                    });
                }
            }
        }

        // ── Audit log ───────────────────────────────────────────────────
        const clientIP = getClientIP(req);
        await prisma.adminAuditLog.create({
            data: {
                adminId: req.adminId!,
                adminName: req.adminName || 'Manager',
                action: 'CATALOG_BULK_UPDATE',
                entity: 'CatalogItem',
                targetId: null,
                oldValue: {
                    snapshot: validUpdates.map(u => ({
                        id: u.id,
                        prevDisplayPrice: u.prevDisplayPrice,
                        prevDiscountedPrice: u.prevDiscountedPrice,
                    })),
                },
                newValue: {
                    filename: filename || 'unknown.csv',
                    updatedCount: successCount,
                    failedCount: failedErrors.length,
                    totalSubmitted: updates.length,
                },
                ipAddress: clientIP,
            },
        });

        console.log(`[CatalogBulk] Bulk update complete: ${successCount} updated, ${failedErrors.length} failed (by ${req.adminName})`);

        res.json({
            success: successCount,
            failed: failedErrors.length,
            errors: failedErrors,
        });
    } catch (error: any) {
        console.error('[CatalogBulk] Execution error:', error);
        res.status(500).json({ error: 'Failed to execute bulk update', details: error.message });
    }
}
