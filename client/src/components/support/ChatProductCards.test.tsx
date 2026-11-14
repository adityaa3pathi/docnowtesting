// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    addToCart: vi.fn(),
    items: [] as { testCode: string }[],
    authed: true,
    pending: null as null | (() => void),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ cart: { items: m.items }, addToCart: m.addToCart }) }));
vi.mock('@/contexts/AuthGateContext', () => ({
    useAuthGate: () => ({ requireAuth: (fn: () => void) => (m.authed ? fn() : (m.pending = fn)) }),
}));
const { ChatProductCards, productHref } = await import('./ChatProductCards');
const { toProductCards } = await import('@/hooks/useSupportChat');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const CARD = { code: 'profile_16', name: 'Thyroid Profile', type: 'PROFILE', price: 399, mrp: 800 };

function mount() {
    const el = document.createElement('div');
    act(() => createRoot(el).render(<ChatProductCards cards={[CARD]} />));
    return el;
}
const button = (el: HTMLElement) => el.querySelector('button') as HTMLButtonElement;

beforeEach(() => {
    m.addToCart.mockReset();
    m.items = [];
    m.authed = true;
    m.pending = null;
});

describe('chat product cards', () => {
    it('links to the product page and shows price and MRP', () => {
        const el = mount();
        expect(el.querySelector('a')?.getAttribute('href')).toBe('/profiles/thyroid-profile--profile_16');
        expect(el.textContent).toContain('₹399');
        expect(el.textContent).toContain('₹800');
        expect(productHref({ ...CARD, type: 'TEST' })).toMatch(/^\/tests\//);
    });

    it('adds once with one key, even when tapped twice', async () => {
        let finish: (ok: boolean) => void = () => {};
        m.addToCart.mockImplementation(() => new Promise((r) => { finish = r; }));
        const el = mount();
        await act(async () => { button(el).click(); });
        await act(async () => { button(el).click(); });
        expect(m.addToCart).toHaveBeenCalledTimes(1);
        const [code, , price, mrp, opts] = m.addToCart.mock.calls[0];
        expect([code, price, mrp]).toEqual(['profile_16', 399, 800]);
        expect(opts.idempotencyKey).toEqual(expect.any(String));
        await act(async () => { finish(true); });
        expect(el.textContent).toContain('In cart');
    });

    it('asks to log in first, then adds', async () => {
        m.authed = false;
        m.addToCart.mockResolvedValue(true);
        const el = mount();
        await act(async () => { button(el).click(); });
        expect(m.addToCart).not.toHaveBeenCalled();
        await act(async () => { m.pending?.(); });
        expect(m.addToCart).toHaveBeenCalledTimes(1);
    });

    it('offers to add again when the test is already in the cart', () => {
        m.items = [{ testCode: 'profile_16' }];
        expect(button(mount()).textContent).toBe('Add for another person');
    });

    it('drops malformed cards from the server', () => {
        const cards = toProductCards([{ code: 'a', name: 'A', price: 1, sample_type: 'Blood' }, { code: 'b' }, null]);
        expect(cards).toEqual([{ code: 'a', name: 'A', type: 'TEST', price: 1, mrp: null, sampleType: 'Blood', reportTime: null }]);
        expect(toProductCards(undefined)).toEqual([]);
    });
});
