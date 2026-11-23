// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { AllergyAlert } from './AllergyAlert';

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function render(props: Parameters<typeof AllergyAlert>[0]) {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<AllergyAlert {...props} />));
    const el = host.querySelector('[data-testid="allergy-alert"]') as HTMLElement;
    return { state: el.dataset.state, text: el.textContent ?? '', role: el.getAttribute('role') };
}

describe('AllergyAlert', () => {
    it('shows listed allergies as an alert', () => {
        expect(render({ allergies: ['Penicillin', 'Sulfa'], allergiesConfirmedAt: null })).toEqual({ state: 'listed', text: 'Allergies: Penicillin, Sulfa', role: 'alert' });
    });
    it('never shows "never asked" as "none"', () => {
        const r = render({ allergies: [], allergiesConfirmedAt: null });
        expect(r.state).toBe('unknown');
        expect(r.text).toMatch(/not confirmed/i);
        expect(render({}).state).toBe('unknown');
    });
    it('shows a confirmed "no known allergies"', () => {
        const r = render({ allergies: [], allergiesConfirmedAt: '2026-11-24T05:00:00Z', variant: 'overlay' });
        expect(r.state).toBe('none');
        expect(r.text).toMatch(/No known allergies/);
    });
});
