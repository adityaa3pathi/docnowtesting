// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoctorFilters } from './DoctorFilters';
import { NO_FILTERS, type DoctorFilterState } from '@/lib/consult/doctorFilters';

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let onChange: ReturnType<typeof vi.fn<(f: DoctorFilterState) => void>>;
const render = (value: DoctorFilterState) => act(async () => root.render(
    <DoctorFilters value={value} onChange={onChange} languages={['Hindi', 'English']} total={4} loading={false} />,
));
const input = () => document.body.querySelector('input[type=search]') as HTMLInputElement;
const byText = (re: RegExp) => Array.from(document.body.querySelectorAll('button')).filter((b) => re.test(b.textContent ?? ''));
/** React tracks the input's value, so set it through the native setter. */
function type(text: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onChange = vi.fn<(f: DoctorFilterState) => void>();
});
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('DoctorFilters', () => {
    it('searches once typing pauses, back on page 1, and not on every key', async () => {
        await render({ ...NO_FILTERS, page: 3 });
        await act(async () => { type('An'); vi.advanceTimersByTime(100); type('Anil'); });
        expect(onChange).not.toHaveBeenCalled();
        await act(async () => { vi.advanceTimersByTime(300); });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toMatchObject({ q: 'Anil', page: 1 });
    });

    it('keeps letters typed while the last search was on its way, and shows outside changes', async () => {
        await render(NO_FILTERS);
        await act(async () => { type('Anil'); vi.advanceTimersByTime(300); });
        await act(async () => { type('Anil M'); });
        await render({ ...NO_FILTERS, q: 'Anil' }); // our own search lands in the URL
        expect(input().value).toBe('Anil M');
        await render(NO_FILTERS); // Clear all
        expect(input().value).toBe('');
        await render({ ...NO_FILTERS, q: 'Anil' }); // back button
        expect(input().value).toBe('Anil');
    });

    it('Online now is a toggle that starts the list again at page 1', async () => {
        await render({ ...NO_FILTERS, page: 2 });
        const chip = byText(/Online now/)[0];
        expect(chip.getAttribute('aria-pressed')).toBe('false');
        await act(async () => chip.click());
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ now: true, page: 1 }));
    });

    it('the phone sheet changes nothing until Show doctors, then applies every pick at once', async () => {
        await render({ ...NO_FILTERS, now: true, page: 2 });
        await act(async () => byText(/^Filters/)[0].click());
        expect(document.body.querySelector('[role=dialog]')).not.toBeNull();
        const option = (label: string) => Array.from(document.body.querySelectorAll('[role=dialog] button')).find((b) => b.textContent === label) as HTMLButtonElement;
        await act(async () => option('Hindi').click());
        await act(async () => option('Female doctor').click());
        await act(async () => option('Fee: low to high').click());
        expect(onChange).not.toHaveBeenCalled();
        await act(async () => byText(/Show doctors/)[0].click());
        expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, now: true, languages: ['Hindi'], gender: 'Female', sort: 'fee_low', page: 1 });
        expect(document.body.querySelector('[role=dialog]')).toBeNull();
    });

    it('the sheet keeps a search that landed while it was open', async () => {
        await render(NO_FILTERS);
        await act(async () => byText(/^Filters/)[0].click());
        await render({ ...NO_FILTERS, q: 'Anil' }); // the debounced search reaches the URL now
        const option = (label: string) => Array.from(document.body.querySelectorAll('[role=dialog] button')).find((b) => b.textContent === label) as HTMLButtonElement;
        await act(async () => option('Female doctor').click());
        await act(async () => byText(/Show doctors/)[0].click());
        expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, q: 'Anil', gender: 'Female' });
    });

    it('says "match" only when something narrows the list, not for a sort', async () => {
        await render({ ...NO_FILTERS, sort: 'fee_low' });
        expect(document.body.textContent).toContain('4 doctors');
        expect(document.body.textContent).not.toContain('match');
        await render({ ...NO_FILTERS, gender: 'Male' });
        expect(document.body.textContent).toContain('4 doctors match');
    });

    it('the sheet counts its own filters and sort, but not Online now (that chip sits beside it)', async () => {
        await render({ ...NO_FILTERS, now: true, gender: 'Male', sort: 'experience' });
        expect(byText(/^Filters/)[0].textContent).toBe('Filters · 2');
    });
});
