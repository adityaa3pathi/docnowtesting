import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ prisma: {} }));
const { handleStatusUpdate } = await import('./healthiansWebhook');

function fakeTx() {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    return { tx: { booking: { update: vi.fn().mockResolvedValue({}), updateMany }, bookingItem: { updateMany: vi.fn() } } as any, updateMany };
}
const status = (over: object) => ({ booking_status: 'BS005', payment_status: true, paid_amount: '899', ...over }) as any;
const cod = { id: 'b1', items: [], paymentMethod: 'PAY_ON_COLLECTION', collectedAt: null, finalAmount: 899 };

describe('pay on collection from the Healthians status webhook', () => {
    it('records the collection once the collector reports full payment', async () => {
        const { tx, updateMany } = fakeTx();
        expect(await handleStatusUpdate(tx, cod, status({}))).toEqual({ collectedNow: true });
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'b1', collectedAt: null },
            data: expect.objectContaining({ collectedAmount: 899 }),
        }));
    });

    it('ignores unpaid, short, already-recorded and online bookings', async () => {
        for (const [booking, data] of [
            [cod, status({ payment_status: false })],
            [cod, status({ paid_amount: '400' })],
            [{ ...cod, collectedAt: new Date() }, status({})],
            [{ ...cod, paymentMethod: 'ONLINE' }, status({})],
        ] as const) {
            const { tx, updateMany } = fakeTx();
            expect(await handleStatusUpdate(tx, booking, data)).toEqual({ collectedNow: false });
            expect(updateMany).not.toHaveBeenCalled();
        }
    });
});
