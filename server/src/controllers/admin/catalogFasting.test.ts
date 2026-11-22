import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
    const tx = {
        catalogItem: { update: vi.fn() },
        adminAuditLog: { create: vi.fn() },
    };
    return {
        tx,
        prisma: {
            catalogItem: { findUnique: vi.fn() },
            $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
        },
    };
});

vi.mock('../../db', () => ({ prisma: db.prisma }));
vi.mock('../../adapters/healthians', () => ({ HealthiansAdapter: { getInstance: () => ({}) } }));

import { updateCatalogItemFasting } from './catalog';

function call(body: unknown, userId: string | undefined = 'mgr-1') {
    const req = { params: { id: 'item-1' }, body, userId, adminName: 'Asha' } as any;
    const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
    return updateCatalogItemFasting(req, res).then(() => res);
}

describe('updateCatalogItemFasting', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejects invalid input before touching the database', async () => {
        const res = await call({ fasting: 'Not Required', fastingHours: 12 });
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.prisma.catalogItem.findUnique).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown item', async () => {
        db.prisma.catalogItem.findUnique.mockResolvedValue(null);
        const res = await call({ fasting: 'Not Required' });
        expect(res.status).toHaveBeenCalledWith(404);
        expect(db.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('saves the correction and records old and new values in the audit log', async () => {
        db.prisma.catalogItem.findUnique.mockResolvedValue({ id: 'item-1', fastingOverride: null, fastingTimeOverride: null });
        const saved = { id: 'item-1', fastingOverride: 'Not Required', fastingTimeOverride: null };
        db.tx.catalogItem.update.mockResolvedValue(saved);

        const res = await call({ fasting: 'Not Required' });

        expect(db.tx.catalogItem.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'item-1' },
            data: { fastingOverride: 'Not Required', fastingTimeOverride: null },
        }));
        expect(db.tx.adminAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                adminId: 'mgr-1',
                action: 'CATALOG_FASTING_OVERRIDE',
                targetId: 'item-1',
                oldValue: { fastingOverride: null, fastingTimeOverride: null },
                newValue: { fastingOverride: 'Not Required', fastingTimeOverride: null },
            }),
        });
        expect(res.json).toHaveBeenCalledWith(saved);
    });

    it('null fasting removes the correction (back to Healthians)', async () => {
        db.prisma.catalogItem.findUnique.mockResolvedValue({ id: 'item-1', fastingOverride: 'Required', fastingTimeOverride: '10 hour(s)' });
        db.tx.catalogItem.update.mockResolvedValue({ id: 'item-1', fastingOverride: null, fastingTimeOverride: null });

        await call({ fasting: null });

        expect(db.tx.catalogItem.update).toHaveBeenCalledWith(expect.objectContaining({
            data: { fastingOverride: null, fastingTimeOverride: null },
        }));
    });

    it('does not report success when the audit write fails', async () => {
        db.prisma.catalogItem.findUnique.mockResolvedValue({ id: 'item-1', fastingOverride: null, fastingTimeOverride: null });
        db.tx.catalogItem.update.mockResolvedValue({ id: 'item-1', fastingOverride: 'Not Required', fastingTimeOverride: null });
        db.tx.adminAuditLog.create.mockRejectedValueOnce(new Error('audit down'));

        const res = await call({ fasting: 'Not Required' });

        expect(res.status).toHaveBeenCalledWith(500);
    });
});
