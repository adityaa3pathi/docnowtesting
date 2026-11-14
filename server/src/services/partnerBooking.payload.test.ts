import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ createBooking: vi.fn() }));

vi.mock('../db', () => ({
    prisma: {
        user: { findUnique: async () => ({ id: 'u1', name: 'Asha', mobile: '7000000001', email: null, gender: 'F' }) },
        address: { findUnique: async () => ({ id: 'a1', line1: '12 Test Road', city: 'Jaipur', pincode: '302001', lat: '26.9', long: '75.7' }), update: () => ({ catch: () => undefined }) },
        patient: { findUnique: async () => null },
    },
}));
vi.mock('../adapters/healthians', () => ({
    HealthiansAdapter: { getInstance: () => ({ checkServiceability: async () => ({ data: { zone_id: 'Z9' } }), createBooking: m.createBooking }) },
}));
vi.mock('../utils/geocoding', () => ({ getGeodataFromPincode: async () => null }));
vi.mock('../utils/logger', () => ({ logBusinessEvent: vi.fn(), logAlert: vi.fn(), logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { createHealthiansBooking } = await import('./partnerBooking');

const items = [{ id: 'i1', patientId: 'p1', testCode: 'DEAL1', testName: 'CBC', price: 999, patient: { id: 'p1', name: 'Asha', relation: 'SELF', age: 30, gender: 'F' } }];
const booking = (over: object) => ({ id: 'b1', addressId: 'a1', partnerSlotId: 'stm_1', totalAmount: 1128, finalAmount: 849, items, ...over });

beforeEach(() => {
    m.createBooking.mockReset().mockResolvedValue({ status: true, booking_id: 'HB1' });
});

const sentPayload = () => m.createBooking.mock.calls[0][0];

describe('what the Healthians payload says about payment', () => {
    it('sends cod and only whole rupees for a pay-on-collection booking', async () => {
        await createHealthiansBooking(booking({ paymentMethod: 'PAY_ON_COLLECTION', finalAmount: 849.6 }), 'u1');
        expect(sentPayload()).toMatchObject({ payment_option: 'cod', discounted_price: 849 });
    });

    it('sends prepaid and the full order total for an online booking', async () => {
        await createHealthiansBooking(booking({ paymentMethod: 'ONLINE' }), 'u1');
        expect(sentPayload()).toMatchObject({ payment_option: 'prepaid', discounted_price: 1128 });
    });

    it('treats a booking with no payment method as prepaid', async () => {
        await createHealthiansBooking(booking({}), 'u1');
        expect(sentPayload().payment_option).toBe('prepaid');
    });
});
