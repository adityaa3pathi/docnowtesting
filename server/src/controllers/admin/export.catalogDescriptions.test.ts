import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    prisma: { catalogItem: { findMany: vi.fn() } },
}));

vi.mock('../../db', () => ({ prisma: db.prisma }));
vi.mock('./salesReport', () => ({ buildSalesReportRows: vi.fn(), salesReportRowsToCsv: vi.fn() }));
vi.mock('./settlementReport', () => ({ buildSettlementRows: vi.fn(), settlementRowsToCsv: vi.fn() }));

import { buildCatalogDescriptionsCsv, exportAdminData } from './export';

describe('catalog-descriptions export', () => {
    beforeEach(() => vi.clearAllMocks());

    it('has product name, type and description beside the ID, with text safely quoted', async () => {
        db.prisma.catalogItem.findMany.mockResolvedValue([
            { id: 'id-1', name: 'Lipid Profile, Basic', type: 'PROFILE', partnerCode: 'P-1', isEnabled: true, purpose: 'Checks "good" and bad\ncholesterol' },
            { id: 'id-2', name: 'CBC', type: 'TEST', partnerCode: 'T-2', isEnabled: false, purpose: null },
        ]);

        const csv = await buildCatalogDescriptionsCsv({}, 10000);
        expect(csv.startsWith('﻿')).toBe(true);

        const lines = csv.slice(1).split('\r\n');
        expect(lines[0]).toBe('"Product ID","Product Name","Product Type","Healthians Deal ID","Status","Description"');
        expect(lines[1]).toBe('"id-1","Lipid Profile, Basic","Profile","P-1","Enabled","Checks ""good"" and bad\ncholesterol"');
        expect(lines[2]).toBe('"id-2","CBC","Test","T-2","Disabled",""');
    });

    it('never selects prices, so managers can be given this file', async () => {
        db.prisma.catalogItem.findMany.mockResolvedValue([]);
        await buildCatalogDescriptionsCsv({}, 10000);
        const { select } = db.prisma.catalogItem.findMany.mock.calls[0][0];
        expect(Object.keys(select).some((k) => /price/i.test(k))).toBe(false);
    });

    it('applies the type filter and ignores unknown types', async () => {
        db.prisma.catalogItem.findMany.mockResolvedValue([]);
        await buildCatalogDescriptionsCsv({ type: 'PACKAGE' }, 10000);
        expect(db.prisma.catalogItem.findMany.mock.calls[0][0].where).toEqual({ type: 'PACKAGE' });

        await buildCatalogDescriptionsCsv({ type: 'DROP TABLE' }, 10000);
        expect(db.prisma.catalogItem.findMany.mock.calls[1][0].where).toEqual({});
    });

    it('is accepted by the export endpoint and sent as a CSV download', async () => {
        db.prisma.catalogItem.findMany.mockResolvedValue([]);
        const res: any = { setHeader: vi.fn(), status: vi.fn(() => res), send: vi.fn(() => res), json: vi.fn(() => res) };
        await exportAdminData({ query: { entity: 'catalog-descriptions' } } as any, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="product-descriptions.csv"');
    });
});
