// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutPaymentMethod } from '@/components/cart/PaymentMethodPicker';

const m = vi.hoisted(() => ({
    post: vi.fn(),
    push: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ default: { post: m.post, get: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock('react-hot-toast', () => ({
    default: { error: m.toastError, success: m.toastSuccess },
}));
const { useCheckout } = await import('./useCheckout');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const SLOT = { slot_time: '08:00 AM - 09:00 AM', stm_id: 'stm-7', slot_date: '2026-11-20' };

function deps(paymentMethod: CheckoutPaymentMethod) {
    return {
        slots: [SLOT],
        selectedTime: SLOT.slot_time,
        selectedDate: '2026-11-20',
        selectedAddressId: 'addr-1',
        selectedAddress: { id: 'addr-1', line1: '1 Road', city: 'Jaipur', pincode: '302001' },
        cartId: 'cart-1',
        appliedPromo: null,
        useWallet: false,
        billingPatientId: 'self',
        isSlotLocked: true,
        cartItems: [{ testCode: 'test_1', testName: 'CBC' }],
        refreshCart: async () => {},
        paymentMethod,
    };
}

let seen: ReturnType<typeof useCheckout> | null = null;
function mount(paymentMethod: CheckoutPaymentMethod) {
    function Probe() {
        seen = useCheckout(deps(paymentMethod));
        return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
    return root;
}

// Reading window.Razorpay is the only way into the checkout popup (script load or construction),
// so counting reads proves the pay-on-collection path never touches it.
let razorpayReads = 0;
const rzpOpen = vi.fn();
const rzpOn = vi.fn();
const Razorpay = vi.fn(function () { return { on: rzpOn, open: rzpOpen }; });

const initiateBody = () => m.post.mock.calls.find((c) => c[0] === '/payments/initiate')?.[1];
const razorpayScripts = () => document.querySelectorAll('script[src*="checkout.razorpay.com"]').length;

beforeEach(() => {
    m.post.mockReset();
    m.push.mockReset();
    m.toastError.mockReset();
    m.toastSuccess.mockReset();
    Razorpay.mockClear();
    rzpOpen.mockClear();
    razorpayReads = 0;
    Object.defineProperty(window, 'Razorpay', {
        configurable: true,
        get: () => { razorpayReads += 1; return Razorpay; },
    });
    m.post.mockImplementation(async (url: string) => {
        if (url === '/payments/validate') return { data: { valid: true, unavailable: [] } };
        throw new Error(`unexpected post ${url}`);
    });
});

describe('useCheckout: pay at sample collection', () => {
    it('places the order without any payment screen', async () => {
        m.post.mockImplementation(async (url: string) => {
            if (url === '/payments/validate') return { data: { valid: true } };
            if (url === '/payments/initiate') {
                return { data: { bookingId: 'bk-1', amount: 1299, paymentMethod: 'PAY_ON_COLLECTION' } };
            }
            throw new Error(`unexpected post ${url}`);
        });

        const root = mount('PAY_ON_COLLECTION');
        await act(async () => seen!.handleCheckout());

        expect(initiateBody()).toMatchObject({ paymentMethod: 'PAY_ON_COLLECTION', slot_id: 'stm-7' });
        expect(m.push).toHaveBeenCalledWith('/thank-you?bookingId=bk-1');
        expect(razorpayReads).toBe(0);
        expect(Razorpay).not.toHaveBeenCalled();
        expect(razorpayScripts()).toBe(0);
        expect(m.toastSuccess).toHaveBeenCalledWith(expect.stringContaining('₹1299'), expect.anything());
        act(() => root.unmount());
    });

    it('shows the error and stays on the cart when the server has it switched off', async () => {
        m.post.mockImplementation(async (url: string) => {
            if (url === '/payments/validate') return { data: { valid: true } };
            throw Object.assign(new Error('rejected'), {
                response: { status: 400, data: { code: 'PAY_ON_COLLECTION_OFF', error: 'Pay at collection is not available right now.' } },
            });
        });

        const root = mount('PAY_ON_COLLECTION');
        await act(async () => seen!.handleCheckout());

        expect(m.toastError).toHaveBeenCalledWith('Pay at collection is not available right now.');
        expect(m.push).not.toHaveBeenCalled();
        expect(razorpayReads).toBe(0);
        expect(seen!.creatingOrder).toBe(false);
        act(() => root.unmount());
    });
});

describe('useCheckout: online', () => {
    it('creates a Razorpay order and opens the checkout', async () => {
        m.post.mockImplementation(async (url: string) => {
            if (url === '/payments/validate') return { data: { valid: true } };
            if (url === '/payments/initiate') {
                return { data: { bookingId: 'bk-2', razorpayOrderId: 'order_9', amount: 1299, keyId: 'rzp_test', paymentMethod: 'ONLINE' } };
            }
            throw new Error(`unexpected post ${url}`);
        });

        const root = mount('ONLINE');
        await act(async () => seen!.handleCheckout());

        expect(initiateBody()).toMatchObject({ paymentMethod: 'ONLINE' });
        expect(Razorpay).toHaveBeenCalledTimes(1);
        expect((Razorpay.mock.calls as unknown as unknown[][])[0][0]).toMatchObject({ order_id: 'order_9', key: 'rzp_test', amount: 1299 });
        expect(rzpOpen).toHaveBeenCalledTimes(1);
        expect(m.push).not.toHaveBeenCalled();
        act(() => root.unmount());
    });
});
