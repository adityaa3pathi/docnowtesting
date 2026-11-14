// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOP_CITIES } from './CityLandmarkIcon';

const m = vi.hoisted(() => ({ updateCity: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/api', () => ({ getApiUrl: () => 'http://localhost:5000/api' }));
vi.mock('@/contexts/LocationContext', () => ({
    useLocation: () => ({
        selectedCity: 'Gurgaon', selectedPincode: '122001', updateCity: m.updateCity,
        updatePincode: vi.fn(), checkAndSetPincode: vi.fn(), serviceabilityStatus: 'idle',
    }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false, logout: vi.fn() }) }));
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ cartCount: 0 }) }));
vi.mock('@/contexts/AuthGateContext', () => ({ useAuthGate: () => ({ openAuthDialog: vi.fn() }) }));
vi.mock('./global-search/GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('./DocnowLogo', () => ({ DocnowLogo: () => null }));
const { Header } = await import('./Header');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const buttons = () => Array.from(dialog().querySelectorAll('button'));
// Top-city buttons wrap the name in a span next to the landmark svg (whose <title> is also text).
const cityNames = () => buttons().map((b) => (b.querySelector('span')?.textContent ?? b.textContent ?? '').trim());
const search = () => document.body.querySelector('[placeholder="Search for your city..."]') as HTMLInputElement;

const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
async function typeSearch(value: string) {
    const input = search();
    await act(async () => {
        nativeValue.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

let root: ReturnType<typeof createRoot>;
async function openCityPicker() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Header />));
    // The desktop trigger shows the current city alone; the mobile one adds a "City" label.
    const trigger = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Gurgaon')!;
    await act(async () => { trigger.click(); });
    expect(search()).toBeTruthy();
}

beforeEach(() => {
    m.updateCity.mockReset();
});

afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
});

describe('city picker', () => {
    it('puts Jaipur first among the top cities', async () => {
        await openCityPicker();

        expect(TOP_CITIES[0]).toBe('Jaipur');
        const names = cityNames();
        expect(names.filter((n) => (TOP_CITIES as readonly string[]).includes(n))[0]).toBe('Jaipur');
        expect(names.indexOf('Jaipur')).toBeLessThan(names.indexOf('Mumbai'));
    });

    it('searches every city, not just the list shown by default', async () => {
        await openCityPicker();

        // Bengaluru is a top city, so the default "Other cities" grid leaves it out.
        await typeSearch('beng');
        expect(cityNames()).toContain('Bengaluru');
        expect(document.body.textContent).not.toContain('Other cities');

        await typeSearch('mysu');
        expect(cityNames()).toContain('Mysuru');
        expect(cityNames()).not.toContain('Bengaluru');
    });

    it('sets the city once from a search result', async () => {
        await openCityPicker();
        await typeSearch('udaip');

        await act(async () => { buttons().find((b) => b.textContent?.trim() === 'Udaipur')!.click(); });

        expect(m.updateCity).toHaveBeenCalledWith('Udaipur');
        expect(m.updateCity).toHaveBeenCalledTimes(1);
    });
});
