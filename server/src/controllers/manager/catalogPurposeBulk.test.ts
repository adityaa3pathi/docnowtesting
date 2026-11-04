import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
    return {
        prisma: {
            catalogItem: {
                findMany: vi.fn(),
                update: vi.fn(),
            },
            adminAuditLog: {
                create: vi.fn(),
            },
        },
    };
});

vi.mock('../../db', () => ({ prisma: db.prisma }));
vi.mock('../../utils/adminHelpers', () => ({ getClientIP: () => '127.0.0.1' }));

import { validatePurposeImport, executePurposeImport } from './catalogPurposeBulk';

describe('catalogPurposeBulk', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('validatePurposeImport', () => {
        function callValidate(body: unknown) {
            const req = { body, adminId: 'mgr-1', adminName: 'Manager' } as any;
            const res: any = {
                status: vi.fn(() => res),
                json: vi.fn(() => res),
            };
            return validatePurposeImport(req, res).then(() => res);
        }

        it('returns 400 when rows array is missing or empty', async () => {
            const res1 = await callValidate({});
            expect(res1.status).toHaveBeenCalledWith(400);

            const res2 = await callValidate({ rows: [] });
            expect(res2.status).toHaveBeenCalledWith(400);
        });

        it('validates rows, handles missing items, and formats preview correctly', async () => {
            db.prisma.catalogItem.findMany.mockResolvedValue([
                { id: 'item-1', name: 'CBC Test', type: 'TEST', purpose: 'Old CBC Purpose' },
                { id: 'item-2', name: 'Lipid Profile', type: 'PACKAGE', purpose: null },
            ]);

            const rows = [
                { id: '', purpose: 'Some text' }, // Missing ID
                { id: 'item-1', purpose: 'New CBC Purpose' }, // Changed
                { id: 'item-2', purpose: '   ' }, // Clear purpose, but was null -> unchanged
                { id: 'item-3', purpose: 'Valid text' }, // Not found in DB
                { id: 'item-4', purpose: 'x'.repeat(301) }, // Exceeds PURPOSE_MAX_LENGTH
            ];

            const res = await callValidate({ rows });
            expect(res.json).toHaveBeenCalled();
            const data = res.json.mock.calls[0][0];

            expect(data.summary).toEqual({
                totalRows: 5,
                validUpdates: 1,
                unchanged: 1,
                invalid: 3, // row 2 (no id), row 5 (not found), row 6 (exceeds 300)
            });

            expect(data.preview).toHaveLength(2);
            expect(data.preview[0]).toEqual({
                id: 'item-1',
                name: 'CBC Test',
                type: 'TEST',
                currentPurpose: 'Old CBC Purpose',
                newPurpose: 'New CBC Purpose',
                changed: true,
            });
            expect(data.preview[1]).toEqual({
                id: 'item-2',
                name: 'Lipid Profile',
                type: 'PACKAGE',
                currentPurpose: null,
                newPurpose: null,
                changed: false,
            });

            expect(data.errors).toHaveLength(3);
        });

        it('handles duplicate product IDs by taking the last row', async () => {
            db.prisma.catalogItem.findMany.mockResolvedValue([
                { id: 'item-1', name: 'CBC Test', type: 'TEST', purpose: 'Original' },
            ]);

            const rows = [
                { id: 'item-1', purpose: 'First Occurrence' },
                { id: 'item-1', purpose: 'Second Occurrence' },
            ];

            const res = await callValidate({ rows });
            const data = res.json.mock.calls[0][0];

            expect(data.preview).toHaveLength(1);
            expect(data.preview[0].newPurpose).toBe('Second Occurrence');
        });
    });

    describe('executePurposeImport', () => {
        function callExecute(body: unknown) {
            const req = { body, adminId: 'mgr-1', adminName: 'Test Manager' } as any;
            const res: any = {
                status: vi.fn(() => res),
                json: vi.fn(() => res),
            };
            return executePurposeImport(req, res).then(() => res);
        }

        it('returns 400 when updates array is missing or empty', async () => {
            const res = await callExecute({ updates: [] });
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('returns message when no changes to apply', async () => {
            db.prisma.catalogItem.findMany.mockResolvedValue([
                { id: 'item-1', purpose: 'Existing' },
            ]);

            const res = await callExecute({
                updates: [{ id: 'item-1', purpose: 'Existing' }],
                filename: 'test.csv',
            });

            const data = res.json.mock.calls[0][0];
            expect(data.success).toBe(0);
            expect(data.message).toBe('No changes to apply.');
            expect(db.prisma.catalogItem.update).not.toHaveBeenCalled();
        });

        it('executes batched updates and logs audit entry', async () => {
            db.prisma.catalogItem.findMany.mockResolvedValue([
                { id: 'item-1', purpose: 'Old Purpose 1' },
                { id: 'item-2', purpose: 'Old Purpose 2' },
            ]);
            db.prisma.catalogItem.update.mockResolvedValue({});
            db.prisma.adminAuditLog.create.mockResolvedValue({});

            const res = await callExecute({
                updates: [
                    { id: 'item-1', purpose: 'New Purpose 1' },
                    { id: 'item-2', purpose: '' }, // Cleared
                    { id: 'item-99', purpose: 'Nonexistent' },
                ],
                filename: 'purpose_import.csv',
            });

            expect(db.prisma.catalogItem.update).toHaveBeenCalledTimes(2);
            expect(db.prisma.catalogItem.update).toHaveBeenCalledWith({
                where: { id: 'item-1' },
                data: { purpose: 'New Purpose 1' },
            });
            expect(db.prisma.catalogItem.update).toHaveBeenCalledWith({
                where: { id: 'item-2' },
                data: { purpose: null },
            });

            expect(db.prisma.adminAuditLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    adminId: 'mgr-1',
                    adminName: 'Test Manager',
                    action: 'CATALOG_PURPOSE_BULK_UPDATE',
                    entity: 'CatalogItem',
                    newValue: expect.objectContaining({
                        filename: 'purpose_import.csv',
                        updatedCount: 2,
                        failedCount: 1,
                        totalSubmitted: 3,
                    }),
                    ipAddress: '127.0.0.1',
                }),
            });

            const data = res.json.mock.calls[0][0];
            expect(data.success).toBe(2);
            expect(data.failed).toBe(1);
            expect(data.errors).toHaveLength(1);
            expect(data.errors[0].id).toBe('item-99');
        });
    });
});
