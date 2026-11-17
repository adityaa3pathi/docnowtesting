// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...args: unknown[]) => get(...args) } }));
const { TestSelector } = await import('./TestSelector');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    get.mockReset();
    vi.useRealTimers();
});

const TESTS = [{ partnerCode: 'CBC1', name: 'Complete Blood Count' }, { partnerCode: 'TSH1', name: 'Thyroid Stimulating Hormone' }];
const reply = (products: unknown[]) => Promise.resolve({ data: { products } });

function Harness({ onChange }: { onChange: (c: string[]) => void }) {
    const [codes, setCodes] = useState<string[]>([]);
    return <TestSelector selectedCodes={codes} onChange={(c) => { setCodes(c); onChange(c); }} />;
}

describe('TestSelector', () => {
    it('opens the catalog on tap and keeps it open while several tests are ticked', async () => {
        get.mockImplementation((path: string) => reply(path === '/catalog/featured' ? [] : TESTS));
        const onChange = vi.fn();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root!.render(<Harness onChange={onChange} />));

        await act(async () => host!.querySelector('input')!.focus());
        // The empty-box load waits a tick, then tries featured tests before the full list.
        for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
        expect(get).toHaveBeenCalledWith('/catalog/products', { params: { type: 'TEST,PROFILE', limit: 20 } });

        const option = (name: string) => [...host!.querySelectorAll('li button')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement;
        act(() => option('Complete Blood Count').click());
        act(() => option('Thyroid Stimulating Hormone').click());
        expect(onChange).toHaveBeenLastCalledWith(['CBC1', 'TSH1']);
        expect(host.textContent).toContain('2 of 10 selected');
        expect(host.querySelector('[aria-label="Selected tests"]')!.textContent).toContain('Complete Blood Count');
    });

    it('searches the real catalog endpoint', async () => {
        vi.useFakeTimers();
        get.mockImplementation(() => reply(TESTS));
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root!.render(<Harness onChange={() => {}} />));
        const input = host.querySelector('input')!;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(input, 'cbc');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => vi.advanceTimersByTime(300));
        expect(get).toHaveBeenCalledWith('/catalog/products', { params: { search: 'cbc', type: 'TEST,PROFILE', limit: 20 } });
    });
});
