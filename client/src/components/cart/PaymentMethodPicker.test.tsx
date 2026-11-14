// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    get: vi.fn(),
    useCheckout: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ default: { get: m.get, post: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/contexts/CartContext', () => ({
    useCart: () => ({
        cart: { id: 'cart-1', items: [{ id: 'i1', testCode: 'test_1', testName: 'CBC', price: 999 }] },
        removeFromCart: vi.fn(),
        updateCartItem: vi.fn(),
        loading: false,
        loadFailed: false,
        refreshCart: vi.fn(),
    }),
}));
vi.mock('@/hooks/useSlots', () => ({
    useSlots: () => ({
        slots: [], selectedTime: '', setSelectedTime: vi.fn(), loadingSlots: false, freezingSlot: false,
        isSlotLocked: false, setIsSlotLocked: vi.fn(), handleFreezeSlot: vi.fn(), onTimeSelect: vi.fn(),
        secondsRemaining: 0, WARNING_AT_SECONDS: 60, URGENT_AT_SECONDS: 30,
    }),
}));
vi.mock('@/hooks/usePromo', () => ({
    usePromo: () => ({
        promoCode: '', setPromoCode: vi.fn(), appliedPromo: null, availablePromos: [], showPromoList: false,
        setShowPromoList: vi.fn(), loadingPromos: false, verifyingPromo: false, promoError: null,
        applyPromo: vi.fn(), removePromo: vi.fn(), walletBalance: 0, useWallet: false, setUseWallet: vi.fn(),
    }),
}));
// The real OrderSummary and PaymentMethodPicker stay; only the surrounding cart widgets are stubbed.
vi.mock('@/hooks/useCheckout', () => ({
    useCheckout: (deps: unknown) => {
        m.useCheckout(deps);
        return { creatingOrder: false, profileDialogOpen: false, setProfileDialogOpen: vi.fn(), missingProfileFields: {}, availabilityErrors: [], handleCheckout: vi.fn() };
    },
}));
vi.mock('@/components/cart/SlotSelector', () => ({ SlotSelector: () => null }));
vi.mock('@/components/cart/AddressSelector', () => ({ AddressSelector: () => null }));
vi.mock('@/components/cart/CartItemCard', () => ({ CartItemCard: () => null }));
vi.mock('@/components/cart/PromoSection', () => ({ PromoSection: () => null }));
vi.mock('@/components/cart/MobileCheckoutBar', () => ({ MobileCheckoutBar: () => null }));
vi.mock('@/components/profile/ProfileCompletionDialog', () => ({ ProfileCompletionDialog: () => null }));
vi.mock('@/components/profile/AddFamilyMemberDialog', () => ({ AddFamilyMemberDialog: () => null }));

const { default: CartPage } = await import('@/app/cart/page');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

async function mount() {
    const el = document.createElement('div');
    await act(async () => createRoot(el).render(<CartPage />));
    return el;
}

const picker = (el: HTMLElement) => el.querySelector('fieldset legend')?.textContent ?? null;
const radio = (el: HTMLElement, value: string) => el.querySelector(`input[value="${value}"]`) as HTMLInputElement | null;
const lastPaymentMethod = () => (m.useCheckout.mock.lastCall?.[0] as { paymentMethod: string }).paymentMethod;

beforeEach(() => {
    m.get.mockReset();
    m.useCheckout.mockClear();
    m.get.mockImplementation(async (url: string) => {
        if (url === '/profile/patients') return { data: [] };
        if (url === '/profile/addresses') return { data: [{ id: 'addr-1', line1: '1 Road', city: 'Jaipur', pincode: '302001' }] };
        return { data: {} };
    });
});

function optionsReply(reply: () => Promise<unknown>) {
    const base = m.get.getMockImplementation()!;
    m.get.mockImplementation(async (url: string) => (url === '/payments/options' ? reply() : base(url)));
}

describe('cart payment method picker', () => {
    it('offers pay at collection only when the server says so, and defaults to online', async () => {
        optionsReply(async () => ({ data: { payOnCollection: true } }));
        const el = await mount();

        expect(picker(el)).toBe('How would you like to pay?');
        expect(radio(el, 'ONLINE')!.checked).toBe(true);
        expect(radio(el, 'PAY_ON_COLLECTION')!.checked).toBe(false);
        expect(lastPaymentMethod()).toBe('ONLINE');
    });

    it('reports the pay-at-collection choice upward', async () => {
        optionsReply(async () => ({ data: { payOnCollection: true } }));
        const el = await mount();

        await act(async () => { radio(el, 'PAY_ON_COLLECTION')!.click(); });

        expect(radio(el, 'PAY_ON_COLLECTION')!.checked).toBe(true);
        expect(lastPaymentMethod()).toBe('PAY_ON_COLLECTION');
        expect(el.textContent).toContain('Pay at collection');
    });

    it('hides the picker when pay on collection is switched off', async () => {
        optionsReply(async () => ({ data: { payOnCollection: false } }));
        const el = await mount();

        expect(picker(el)).toBeNull();
        expect(lastPaymentMethod()).toBe('ONLINE');
    });

    it('stays online-only when the options request fails', async () => {
        optionsReply(() => Promise.reject(new Error('network down')));
        const el = await mount();

        expect(picker(el)).toBeNull();
        expect(lastPaymentMethod()).toBe('ONLINE');
    });
});
