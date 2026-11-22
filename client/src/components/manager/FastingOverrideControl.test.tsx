// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { put: m.put } }));
const { FastingOverrideControl } = await import('./FastingOverrideControl');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// Healthians' data for "Lipid Profile (Non Fasting)" (prod, 2026-11-22).
const ITEM = {
    id: 'item-1', name: 'Lipid Profile (Non Fasting)', fastingOverride: null, fastingTimeOverride: null,
    detailsData: { fasting: 'Required', fastingTime: '12 hour(s)' },
} as const;

let root: Root;
let el: HTMLDivElement;
const onSaved = vi.fn();

function mount(item: Parameters<typeof FastingOverrideControl>[0]['item'] = ITEM) {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => root.render(<FastingOverrideControl item={item} onSaved={onSaved} />));
}

function select(value: string) {
    const s = el.querySelector('select')!;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(s, value);
        s.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function typeHours(value: string) {
    const input = el.querySelector('input[type=number]') as HTMLInputElement;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

const saveButton = () => el.querySelector('button') as HTMLButtonElement;

describe('FastingOverrideControl', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => { act(() => root.unmount()); el.remove(); });

    it('shows the Healthians value and starts with nothing to save', () => {
        mount();
        expect(el.textContent).toContain('Healthians: Required, 12 hour(s)');
        expect(el.textContent).not.toContain('Corrected');
        expect(saveButton().disabled).toBe(true);
    });

    it('saves "Not required" and reports the saved correction', async () => {
        m.put.mockResolvedValue({ data: { id: 'item-1', fastingOverride: 'Not Required', fastingTimeOverride: null } });
        mount();
        select('Not Required');
        await act(async () => saveButton().click());
        expect(m.put).toHaveBeenCalledWith('/manager/catalog/item-1/fasting', { fasting: 'Not Required' });
        expect(onSaved).toHaveBeenCalledWith({ fastingOverride: 'Not Required', fastingTimeOverride: null });
        expect(el.textContent).toContain('Saved');
    });

    it('sends whole hours with "Required" and blocks bad hours', async () => {
        m.put.mockResolvedValue({ data: { id: 'item-1', fastingOverride: 'Required', fastingTimeOverride: '10 hour(s)' } });
        mount({ ...ITEM, fastingOverride: 'Not Required' });
        select('Required');
        typeHours('30');
        expect(saveButton().disabled).toBe(true);
        typeHours('10');
        await act(async () => saveButton().click());
        expect(m.put).toHaveBeenCalledWith('/manager/catalog/item-1/fasting', { fasting: 'Required', fastingHours: 10 });
    });

    it('"Use Healthians value" removes a correction', async () => {
        m.put.mockResolvedValue({ data: { id: 'item-1', fastingOverride: null, fastingTimeOverride: null } });
        mount({ ...ITEM, fastingOverride: 'Not Required' });
        expect(el.textContent).toContain('Corrected');
        select('partner');
        await act(async () => saveButton().click());
        expect(m.put).toHaveBeenCalledWith('/manager/catalog/item-1/fasting', { fasting: null });
    });

    it('shows the server error', async () => {
        m.put.mockRejectedValue({ response: { data: { error: 'fastingHours must be a whole number from 1 to 24' } } });
        mount();
        select('Not Required');
        await act(async () => saveButton().click());
        expect(el.textContent).toContain('fastingHours must be a whole number from 1 to 24');
        expect(onSaved).not.toHaveBeenCalled();
    });
});
