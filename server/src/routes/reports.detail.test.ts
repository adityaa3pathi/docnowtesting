/** GET /api/reports/:reportId — HTTP test with Prisma mocked, so it runs without a database. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve, tokenFor, useTestJwtSecret } from '../modules/consultations/test/http';

useTestJwtSecret();

const db = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    report: { findUnique: vi.fn() },
}));
vi.mock('../db', () => ({ prisma: db }));
// The viewer endpoint never touches storage or ingestion; these load S3 and Healthians at import.
vi.mock('../services/reportStorage', () => ({ reportStorage: {}, originalReportStorageKey: vi.fn() }));
vi.mock('../services/reportIngestion', () => ({ ingestReport: vi.fn() }));
vi.mock('../services/reportBrandingService', () => ({ brandReportPdf: vi.fn() }));

const owner = { id: 'user-1', tokenVersion: 0 };
const report = {
    id: 'rep-1',
    bookingId: 'bk-1',
    vendorCustomerId: 'pat-1',
    isFullReport: true,
    fetchStatus: 'STORED',
    verifiedAt: new Date('2026-10-28T08:00:00Z'),
    generatedAt: new Date('2026-10-28T07:00:00Z'),
    fileSize: 1234,
    booking: {
        userId: 'user-1',
        slotDate: '2026-10-27',
        items: [
            { patientId: 'pat-1', testName: 'CBC', patient: { name: 'Asha' } },
            { patientId: 'pat-1', testName: 'Lipid Profile', patient: { name: 'Asha' } },
            { patientId: 'pat-2', testName: 'HbA1c', patient: { name: 'Ravi' } },
        ],
    },
};

describe('GET /api/reports/:reportId', () => {
    let app: Awaited<ReturnType<typeof serve>>;
    beforeAll(async () => {
        const { default: reportRoutes } = await import('./reports');
        app = await serve('/api/reports', reportRoutes);
    });
    afterAll(() => app.close());
    beforeEach(() => {
        db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, status: 'ACTIVE', tokenVersion: 0 }));
        db.report.findUnique.mockResolvedValue(report);
    });

    const get = (user: { id: string; tokenVersion: number } | null) =>
        fetch(`${app.url}/api/reports/rep-1`, { headers: user ? { authorization: `Bearer ${tokenFor(user)}` } : {} });

    it('returns the patient, their tests and a signed view token to the owner', async () => {
        const res = await get(owner);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ id: 'rep-1', patientName: 'Asha', tests: ['CBC', 'Lipid Profile'], collectedOn: '2026-10-27', fetchStatus: 'STORED' });
        expect(typeof body.viewToken).toBe('string');
        expect(body).not.toHaveProperty('booking');
        expect(body).not.toHaveProperty('vendorCustomerId');

        const { verifyReportAccessToken } = await import('../services/reportAccess');
        expect(verifyReportAccessToken(body.viewToken).reportId).toBe('rep-1');
    });

    it("hides someone else's report as not found", async () => {
        expect((await get({ id: 'user-2', tokenVersion: 0 })).status).toBe(404);
    });

    it('requires sign-in', async () => {
        expect((await get(null)).status).toBe(401);
    });
});
