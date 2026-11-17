// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get } }));
vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams('bookingId=bk-1'),
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Asha' }, isAuthenticated: true }) }));
vi.mock('@/components/Footer', () => ({ Footer: () => null }));
const { ThankYouClient } = await import('./ThankYouClient');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

async function mount() {
    const el = document.createElement('div');
    await act(async () => createRoot(el).render(<ThankYouClient />));
    return el;
}

beforeEach(() => {
    m.get.mockReset();
});

describe('thank you page', () => {
    it('tells a pay-at-collection customer what to pay the collector', async () => {
        m.get.mockResolvedValue({ data: { outcome: 'confirmed', paymentMethod: 'PAY_ON_COLLECTION', amountDue: 1299 } });
        const el = await mount();

        expect(el.textContent).toContain('Please pay ₹1299 to the sample collector at your visit (cash or UPI).');
        expect(el.textContent).toContain('Booking Successful!');
    });

    it('shows no amount due for an order already paid online', async () => {
        m.get.mockResolvedValue({ data: { outcome: 'confirmed', paymentMethod: 'ONLINE', totalAmount: 1299, amountDue: 0 } });
        const el = await mount();

        expect(el.textContent).not.toContain('sample collector at your visit');
        expect(el.textContent).toContain('Booking Successful!');
    });
});
