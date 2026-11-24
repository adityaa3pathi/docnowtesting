// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get } }));
vi.mock('next/link', () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
const { default: Page } = await import('./page');

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const person = (id: string, name: string) => ({ id, name, age: 30, gender: 'Female', visits: 2, lastVisitAt: '2026-11-10T04:30:00.000Z' });
let root: ReturnType<typeof createRoot>;
beforeEach(() => m.get.mockReset());
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });

describe('doctor Patients page', () => {
    it('lists patients, searches by name and pages', async () => {
        m.get.mockResolvedValueOnce({ data: { items: [person('p1', 'Asha Rao')], nextPage: 2 } });
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<Page />));
        await flush();
        expect(m.get).toHaveBeenCalledWith('/doctor/me/patients', { params: { q: undefined, page: 1 } });
        expect(document.body.textContent).toContain('Asha Rao');
        expect(document.querySelector('a[href="/doctor/patients/p1"]')).not.toBeNull();

        m.get.mockResolvedValueOnce({ data: { items: [person('p2', 'Bala Rao')], nextPage: null } });
        await act(async () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Show more')!.click());
        await flush();
        expect(m.get).toHaveBeenLastCalledWith('/doctor/me/patients', { params: { q: undefined, page: 2 } });
        expect(document.body.textContent).toContain('Bala Rao');
        expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Show more')).toBe(false);

        // The same search again (here: the empty one) reloads instead of hanging on the spinner.
        m.get.mockResolvedValueOnce({ data: { items: [person('p1', 'Asha Rao')], nextPage: null } });
        await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
        await flush();
        expect(m.get).toHaveBeenLastCalledWith('/doctor/me/patients', { params: { q: undefined, page: 1 } });
        expect(document.body.textContent).toContain('Asha Rao');

        m.get.mockResolvedValueOnce({ data: { items: [], nextPage: null } });
        const input = document.querySelector('#patient-search') as HTMLInputElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'zzz');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
        await flush();
        expect(m.get).toHaveBeenLastCalledWith('/doctor/me/patients', { params: { q: 'zzz', page: 1 } });
        expect(document.body.textContent).toContain('No patients with that name');
    });
});
