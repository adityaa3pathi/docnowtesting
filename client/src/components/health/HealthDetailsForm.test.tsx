// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { patch: m.patch } }));
const { HealthDetailsForm } = await import('./HealthDetailsForm');
import type { HealthPerson } from '@/lib/health';

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const person: HealthPerson = { id: 'p1', name: 'Kamla', relation: 'Parent', age: 70, gender: 'Female', allergies: [], allergiesConfirmedAt: null };
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement;
const button = (label: string) => Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };

let root: ReturnType<typeof createRoot>;
let onSaved: ReturnType<typeof vi.fn<(p: unknown) => void>>;
function mount(mode: 'full' | 'allergies', p = person) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onSaved = vi.fn<(p: unknown) => void>();
    act(() => root.render(<HealthDetailsForm person={p} mode={mode} onSaved={onSaved} onSkip={() => {}} />));
}

beforeEach(() => {
    m.patch.mockReset();
    m.patch.mockImplementation(async (_url: string, body: object) => ({ data: { patient: { ...person, ...body } } }));
});
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
});

describe('HealthDetailsForm', () => {
    it('the quick prompt needs an allergy or "No known allergies" before saving', async () => {
        mount('allergies');
        await click(button('Save'));
        expect(document.body.textContent).toContain('Add an allergy, or tick "No known allergies".');
        expect(m.patch).not.toHaveBeenCalled();

        await click(q('input[type="checkbox"]'));
        await click(button('Save'));
        expect(m.patch).toHaveBeenCalledWith('/profile/patients/p1', { noKnownAllergies: true });
        expect(onSaved).toHaveBeenCalled();
    });

    it('saves an allergy that was typed but never added with the Add button', async () => {
        mount('allergies');
        const input = q('input[placeholder="e.g. Penicillin"]') as HTMLInputElement;
        await act(async () => {
            nativeValue.call(input, 'Sulfa');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await click(button('Save'));
        expect(m.patch).toHaveBeenCalledWith('/profile/patients/p1', { allergies: ['Sulfa'] });
    });

    it('does not save when typed text cannot be added (too long), and says why', async () => {
        mount('allergies', { ...person, allergies: ['Penicillin'], allergiesConfirmedAt: 'x' });
        const input = q('input[placeholder="e.g. Penicillin"]') as HTMLInputElement;
        await act(async () => {
            nativeValue.call(input, 'x'.repeat(85));
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await click(button('Save'));
        expect(m.patch).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Nothing was saved.');
    });

    it('a tapped suggestion becomes an allergy and blocks "No known allergies"', async () => {
        mount('full');
        await click(button('+ Penicillin'));
        expect((q('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
        await click(button('Save'));
        expect(m.patch).toHaveBeenCalledWith('/profile/patients/p1', { allergies: ['Penicillin'], chronicConditions: [], currentMedications: [], bloodGroup: null });
    });

    it('shows the server error and keeps the form', async () => {
        m.patch.mockRejectedValueOnce({ response: { status: 400, data: { error: 'Allergies entries must be under 80 characters' } } });
        mount('allergies');
        await click(q('input[type="checkbox"]'));
        await click(button('Save'));
        expect(document.body.textContent).toContain('Allergies entries must be under 80 characters');
        expect(onSaved).not.toHaveBeenCalled();
    });
});
