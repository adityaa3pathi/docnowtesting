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

import { updateCatalogItemPurpose } from './catalog';

function call(body: unknown, userId: string | undefined = 'mgr-1') {
    const req = { params: { id: 'item-1' }, body, userId, adminName: 'Asha' } as any;
    const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
    return updateCatalogItemPurpose(req, res).then(() => res);
}

describe('updateCatalogItemPurpose', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejects invalid input before touching the database', async () => {
        const res = await call({ purpose: 'a'.repeat(301) });
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.prisma.catalogItem.findUnique).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown item', async () => {
        db.prisma.catalogItem.findUnique.mockResolvedValue(null);
        const res = await call({ purpose: 'Yearly check' });
        expect(res.status).toHaveBeenCalledWith(404);
        expect(db.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('saves trimmed text and records old and new values in the audit log', async () => {
        db.prisma.catalogItem.findUnique.mockResolvedValue({ purpose: 'Old' });
        db.tx.catalogItem.update.mockResolvedValue({ id: 'item-1', purpose: 'Yearly check' });

        const res = await call({ purpose: '  Yearly check ' });

        expect(db.tx.catalogItem.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'item-1' }, data: { purpose: 'Yearly check' } }),
        );
        expect(db.tx.adminAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                adminId: 'mgr-1',
                action: 'CATALOG_PURPOSE_UPDATE',
                targetId: 'item-1',
                oldValue: { purpose: 'Old' },
                newValue: { purpose: 'Yearly check' },
            }),
        });
        expect(res.json).toHaveBeenCalledWith({ id: 'item-1', purpose: 'Yearly check' });
    });

    it('clears the text when given blank input', async () => {
        db.prisma.catalogItem.findUnique.mockResolvedValue({ purpose: 'Old' });
        db.tx.catalogItem.update.mockResolvedValue({ id: 'item-1', purpose: null });
        await call({ purpose: '   ' });
        expect(db.tx.catalogItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { purpose: null } }));
    });

    it('returns 500 when the audit write fails inside the transaction', async () => {
        db.prisma.catalogItem.findUnique.mockResolvedValue({ purpose: null });
        db.tx.catalogItem.update.mockResolvedValue({ id: 'item-1', purpose: 'x' });
        db.tx.adminAuditLog.create.mockRejectedValue(new Error('audit down'));
        const res = await call({ purpose: 'x' });
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
