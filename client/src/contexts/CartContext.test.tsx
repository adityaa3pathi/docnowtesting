// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), logout: null as null | (() => void) }));
vi.mock('@/lib/api', () => ({ default: { get: m.get } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('./AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, isInitialized: true, onLogout: (cb: () => void) => { m.logout = cb; } }),
}));
const { CartProvider, useCart } = await import('./CartContext');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let seen: ReturnType<typeof useCart> | null = null;
function Probe() {
    seen = useCart();
    return null;
}

function mount() {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<CartProvider><Probe /></CartProvider>));
    return root;
}

describe('CartContext', () => {
    it('drops a /cart reply that arrives after logout', async () => {
        let reply: (v: unknown) => void = () => {};
        m.get.mockReturnValue(new Promise((r) => (reply = r)));
        const root = mount();
        act(() => m.logout!());
        await act(async () => reply({ data: { id: 'c1', userId: 'old-user', items: [{ id: 'i1' }] } }));
        expect(seen!.cart).toBeNull();
        act(() => root.unmount());
    });

    it('reports a failed load instead of an empty cart', async () => {
        m.get.mockRejectedValue(new Error('500'));
        const root = mount();
        await act(async () => {});
        expect(seen!.cart).toBeNull();
        expect(seen!.loadFailed).toBe(true);
        act(() => root.unmount());
    });
});
