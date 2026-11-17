/** GET /api/invoices/booking/:bookingId/link — HTTP test with Prisma mocked, so it runs without a database. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve, tokenFor, useTestJwtSecret } from '../modules/consultations/test/http';

useTestJwtSecret();

const db = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    booking: { findFirst: vi.fn() },
}));
vi.mock('../db', () => ({ prisma: db }));
// PDF generation is not exercised here and loads heavy dependencies at import.
vi.mock('../services/invoiceService', () => ({ generateInvoicePdfForBooking: vi.fn() }));
vi.mock('../services/campInvoiceService', () => ({ generateCampInvoicePdf: vi.fn() }));

describe('GET /api/invoices/booking/:bookingId/link', () => {
    let app: Awaited<ReturnType<typeof serve>>;
    beforeAll(async () => {
        const { default: invoiceRoutes } = await import('./invoices');
        app = await serve('/api/invoices', invoiceRoutes);
    });
    afterAll(() => app.close());
    beforeEach(() => {
        db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, status: 'ACTIVE', tokenVersion: 0 }));
    });

    const get = (userId: string | null) =>
        fetch(`${app.url}/api/invoices/booking/bk-1/link`, {
            headers: userId ? { authorization: `Bearer ${tokenFor({ id: userId, tokenVersion: 0 })}` } : {},
        });

    it('gives the owner of a confirmed booking a token that opens the public invoice link', async () => {
        db.booking.findFirst.mockResolvedValue({ id: 'bk-1', paymentStatus: 'CONFIRMED' });
        const res = await get('user-1');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(db.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bk-1', userId: 'user-1' } }));
        const { verifyInvoiceAccessToken } = await import('../services/invoiceAccess');
        expect(verifyInvoiceAccessToken(body.token).bookingId).toBe('bk-1');
        expect(body.expiresInHours).toBe(72);
    });

    it("treats someone else's booking as not found", async () => {
        db.booking.findFirst.mockResolvedValue(null);
        expect((await get('user-2')).status).toBe(404);
    });

    it('refuses before the booking is paid', async () => {
        db.booking.findFirst.mockResolvedValue({ id: 'bk-1', paymentStatus: 'INITIATED' });
        const res = await get('user-1');
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Invoice is available only after the booking is confirmed.');
    });

    it('requires sign-in', async () => {
        expect((await get(null)).status).toBe(401);
    });
});
