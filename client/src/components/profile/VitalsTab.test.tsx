// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get, post: m.post, patch: m.patch, delete: m.delete }, getApiUrl: (p: string) => `/api${p}` }));
const { VitalsTab } = await import('./VitalsTab');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

const me = { id: 'p-me', name: 'Asha', relation: 'Self', age: 34, gender: 'Female' };
const dad = { id: 'p-dad', name: 'Ravi', relation: 'Father', age: 64, gender: 'Male' };
const reading = { id: 'r1', kind: 'BP', systolic: 132, diastolic: 86, pulse: 72, glucoseMgDl: null, sugarTiming: null, measuredAt: '2026-11-20T03:00:00.000Z', note: null };

function routes(extra: Record<string, unknown> = {}) {
    m.get.mockImplementation(async (url: string, cfg?: { params?: { kind?: string } }) => {
        if (url === '/profile/patients') return { data: [dad, me] };
        if (url.endsWith('/readings')) return { data: { kind: cfg?.params?.kind, days: 90, readings: cfg?.params?.kind === 'BP' ? [reading] : [], total: cfg?.params?.kind === 'BP' ? 1 : 0, limit: 500 } };
        if (url.endsWith('/periods')) return { data: extra.periods ?? { logs: [], estimate: null } };
        throw new Error(`unexpected GET ${url}`);
    });
    m.post.mockImplementation(async (url: string, body: unknown) => {
        if (url === '/profile/patients/ensure-self') return { data: me };
        return { data: { id: 'new', ...(body as object) } };
    });
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.body.textContent ?? '';
const byText = (re: RegExp) => Array.from(document.body.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''))!;
function type(el: HTMLInputElement, value: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
let root: ReturnType<typeof createRoot>;
async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<VitalsTab />));
    await flush();
    await flush();
}

beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); routes(); });
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
});

describe('VitalsTab', () => {
    it('opens on "you" first, with BP readings, the trend chart and the list', async () => {
        await mount();
        expect(byText(/Asha \(you\)/).getAttribute('aria-checked')).toBe('true');
        expect(m.get).toHaveBeenCalledWith('/consult/vitals/p-me/readings', { params: { kind: 'BP', days: 90 } });
        expect(text()).toContain('132/86 mmHg');
        expect(document.body.querySelector('[role="img"][aria-label^="Blood pressure trend"]')).not.toBeNull();
    });

    it('checks the form before sending, and sends a good reading', async () => {
        await mount();
        await act(async () => byText(/Add reading/).click());
        const inputs = Array.from(document.body.querySelectorAll('form input')) as HTMLInputElement[];
        type(inputs[0], '80');
        type(inputs[1], '120');
        await act(async () => byText(/Save reading/).click());
        expect(text()).toContain('The upper number must be higher than the lower one');
        expect(m.post).not.toHaveBeenCalledWith(expect.stringContaining('/readings'), expect.anything());

        type(inputs[0], '125');
        type(inputs[1], '82');
        await act(async () => byText(/Save reading/).click());
        await flush();
        expect(m.post).toHaveBeenCalledWith('/consult/vitals/p-me/readings', expect.objectContaining({ kind: 'BP', systolic: 125, diastolic: 82, pulse: null }));
    });

    it('shows Periods for her, not for a person recorded as male', async () => {
        await mount();
        expect(byText(/^Periods$/)).toBeTruthy();
        await act(async () => byText(/Ravi · Father/).click());
        await flush();
        expect(byText(/^Periods$/)).toBeUndefined();
    });

    it('periods: the estimate is labelled as an estimate, with a calendar and "ended today"', async () => {
        routes({
            periods: {
                logs: [{ id: 'l3', startDate: '2026-11-22', endDate: null, flow: 'HEAVY', symptoms: ['CRAMPS'] }, { id: 'l2', startDate: '2026-10-25', endDate: '2026-10-29', flow: null, symptoms: [] }],
                estimate: { nextStart: '2026-12-20', averageCycleDays: 28, cyclesUsed: 2, passed: false },
            },
        });
        await mount();
        await act(async () => byText(/^Periods$/).click());
        await flush();
        expect(text()).toContain('Next period estimated around 20 Dec 2026');
        expect(text()).toContain('not a medical prediction');
        expect(text()).toContain('still going');
        expect(document.body.querySelector('[role="grid"]')).not.toBeNull();
        m.patch.mockResolvedValue({ data: {} });
        await act(async () => byText(/Period ended today/).click());
        await flush();
        expect(m.patch).toHaveBeenCalledWith('/consult/vitals/periods/l3', { endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    });
});
