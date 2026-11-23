// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get, post: m.post } }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/LocationPicker', () => ({ default: () => null }));

const { default: PaymentLinksPage } = await import('./page');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const text = () => document.body.textContent ?? '';
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await act(async () => {}); };

let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
    vi.useFakeTimers();
    m.get.mockReset();
    m.get.mockImplementation(async (url: string) => {
        if (url === '/manager/users/search') {
            return { data: [
                { id: 'u-blocked', name: 'Blocked Person', mobile: '9876500001', status: 'BLOCKED' },
                { id: 'u-active', name: 'Active Person', mobile: '9876500002', status: 'ACTIVE' },
            ] };
        }
        return { data: [] };
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<PaymentLinksPage />));
});
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
    vi.useRealTimers();
});

async function search(mobile: string) {
    await act(async () => { button('Create Order')!.click(); });
    const input = document.querySelector('input[placeholder="Enter mobile number…"]') as HTMLInputElement;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, mobile);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tick(400);
}

describe('Manager order: customer search', () => {
    it('shows a blocked customer as blocked and does not let the manager pick them', async () => {
        await search('98765');
        expect(text()).toContain("Blocked, can't be booked");
        const row = Array.from(document.querySelectorAll('[aria-disabled="true"]')).find((el) => el.textContent?.includes('Blocked Person'));
        expect(row).toBeDefined();
        expect(row!.tagName).not.toBe('BUTTON');
        await act(async () => { (row as HTMLElement).click(); });
        // Still on the customer step: the search box is there and the active customer is still offered.
        expect(document.querySelector('input[placeholder="Enter mobile number…"]')).not.toBeNull();
        const active = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Active Person'));
        expect(active).toBeDefined();
    });
});
