import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getClientIP } from '../../utils/adminHelpers';
import { PURPOSE_MAX_LENGTH } from '../../utils/catalogPurpose';
import { normalizePurposeForSearch } from '../../utils/searchUtils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PurposeImportRow {
    id: string;
    purpose?: string | null;
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
    currentPurpose: string | null;
    newPurpose: string | null;
    changed: boolean;
}

// ─── Validate ───────────────────────────────────────────────────────────────

/**
 * POST /api/manager/catalog/import-purpose/validate
 *
 * Accepts parsed CSV rows, validates them against the database, and returns
 * a preview of changes without making any mutations.
 */
export async function validatePurposeImport(req: AuthRequest, res: Response) {
    try {
        const { rows } = req.body as { rows: PurposeImportRow[] };

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'No rows provided.' });
        }

        if (rows.length > 10000) {
            return res.status(400).json({ error: 'Too many rows. Maximum 10,000 allowed.' });
        }

        const errors: ValidationError[] = [];
        const validRows: { row: number; id: string; purpose: string | null }[] = [];

        // ── Client-side validation ──────────────────────────────────────
        for (let i = 0; i < rows.length; i++) {
            const rowNum = i + 2; // +2 = 1-indexed + header row
            const row = rows[i];

            if (!row || !row.id || typeof row.id !== 'string' || !row.id.trim()) {
                errors.push({ row: rowNum, id: row?.id || '', field: 'Product ID', message: 'Product ID is required' });
                continue;
            }

            if (row.purpose !== undefined && row.purpose !== null && typeof row.purpose !== 'string') {
                errors.push({ row: rowNum, id: row.id, field: 'Purpose', message: 'Must be text' });
                continue;
            }

            const trimmed = typeof row.purpose === 'string' ? row.purpose.trim() : '';
            if (trimmed.length > PURPOSE_MAX_LENGTH) {
                errors.push({
                    row: rowNum,
                    id: row.id,
                    field: 'Purpose',
                    message: `Must be ${PURPOSE_MAX_LENGTH} characters or fewer`,
                });
                continue;
            }

            const normalizedPurpose = trimmed.length > 0 ? trimmed : null;
            validRows.push({ row: rowNum, id: row.id.trim(), purpose: normalizedPurpose });
        }

        // ── Database lookup — single query ──────────────────────────────
        const uniqueIds = [...new Set(validRows.map(r => r.id))];
        const existingItems = await prisma.catalogItem.findMany({
            where: { id: { in: uniqueIds } },
            select: { id: true, name: true, type: true, purpose: true },
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

            const currentPurpose = existing.purpose ?? null;
            const changed = currentPurpose !== vr.purpose;

            preview.push({
                id: existing.id,
                name: existing.name,
                type: existing.type,
                currentPurpose,
                newPurpose: vr.purpose,
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
        console.error('[CatalogPurposeBulk] Validation error:', error);
        res.status(500).json({ error: 'Failed to validate import', details: error.message });
    }
}

// ─── Execute ────────────────────────────────────────────────────────────────

/**
 * POST /api/manager/catalog/import-purpose/execute
 *
 * Accepts validated updates and executes them in batched database operations.
 * Creates an audit log entry for the bulk operation.
 */
export async function executePurposeImport(req: AuthRequest, res: Response) {
    try {
        const { updates, filename } = req.body as {
            updates: Array<{ id: string; purpose: string | null }>;
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
            select: { id: true, purpose: true },
        });
        const itemMap = new Map(existingItems.map(item => [item.id, item]));

        const validUpdates: Array<{
            id: string;
            purpose: string | null;
            prevPurpose: string | null;
        }> = [];
        const failedErrors: Array<{ id: string; message: string }> = [];

        for (const update of updates) {
            if (!update.id || typeof update.id !== 'string') {
                failedErrors.push({ id: update?.id || '', message: 'Invalid product ID' });
                continue;
            }

            const existing = itemMap.get(update.id);
            if (!existing) {
                failedErrors.push({ id: update.id, message: 'Product not found' });
                continue;
            }

            if (update.purpose !== null && update.purpose !== undefined && typeof update.purpose !== 'string') {
                failedErrors.push({ id: update.id, message: 'Invalid purpose value' });
                continue;
            }

            const trimmed = typeof update.purpose === 'string' ? update.purpose.trim() : '';
            if (trimmed.length > PURPOSE_MAX_LENGTH) {
                failedErrors.push({ id: update.id, message: `Purpose exceeds ${PURPOSE_MAX_LENGTH} characters` });
                continue;
            }

            const newPurpose = trimmed.length > 0 ? trimmed : null;
            const currentPurpose = existing.purpose ?? null;

            // Skip unchanged
            if (currentPurpose === newPurpose) {
                continue;
            }

            validUpdates.push({
                id: update.id,
                purpose: newPurpose,
                prevPurpose: currentPurpose,
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
                            purpose: u.purpose,
                            searchPurpose: normalizePurposeForSearch(u.purpose),
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
                adminId: (req.adminId || req.userId)!,
                adminName: req.adminName || 'Manager',
                action: 'CATALOG_PURPOSE_BULK_UPDATE',
                entity: 'CatalogItem',
                targetId: null,
                oldValue: {
                    snapshot: validUpdates.map(u => ({
                        id: u.id,
                        prevPurpose: u.prevPurpose,
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

        console.log(`[CatalogPurposeBulk] Bulk update complete: ${successCount} updated, ${failedErrors.length} failed (by ${req.adminName})`);

        res.json({
            success: successCount,
            failed: failedErrors.length,
            errors: failedErrors,
        });
    } catch (error: any) {
        console.error('[CatalogPurposeBulk] Execution error:', error);
        res.status(500).json({ error: 'Failed to execute bulk update', details: error.message });
    }
}
