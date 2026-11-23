// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingView, SelfReschedule } from '@/lib/consult/types';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get, post: m.post } }));
const { ChangeTimeDialog } = await import('./ChangeTimeDialog');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const rules: SelfReschedule = { allowed: true, reason: null, used: 0, max: 2, cutoffMinutes: 120, deadline: later(1) };
const booking = { consultationId: 'c1', doctorId: 'd1', doctorName: 'Dr Meera', startsAt: later(1), selfReschedule: rules } as BookingView & { selfReschedule: SelfReschedule };
const slotA = { id: 's-a', startsAt: later(2), endsAt: later(2) };
const slotB = { id: 's-b', startsAt: later(3), endsAt: later(3) };
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const buttons = () => Array.from(document.body.querySelectorAll('button'));
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ''))!;

let root: ReturnType<typeof createRoot>;
let onChanged: ReturnType<typeof vi.fn<(b: BookingView) => void>>;
let onStale: ReturnType<typeof vi.fn<() => void>>;
async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onChanged = vi.fn<(b: BookingView) => void>();
    onStale = vi.fn<() => void>();
    await act(async () => root.render(<ChangeTimeDialog open booking={booking} onClose={() => {}} onChanged={onChanged} onStale={onStale} />));
    await flush();
}
async function pickFirstTime() {
    // The slot chips are the buttons whose label is a time, inside the slot panel.
    const chip = document.body.querySelector('#slot-panel button') as HTMLButtonElement;
    await act(async () => chip.click());
}

beforeEach(() => {
    m.get.mockReset();
    m.post.mockReset();
});
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
});

describe('ChangeTimeDialog', () => {
    it('shows the rules and moves to the picked time', async () => {
        m.get.mockResolvedValue({ data: [slotA, slotB] });
        m.post.mockResolvedValue({ data: { ...booking, startsAt: slotA.startsAt } });
        await mount();
        expect(document.body.textContent).toContain('2 of 2 changes left');
        await pickFirstTime();
        await act(async () => byText(/^Move to/).click());
        await flush();
        expect(m.post).toHaveBeenCalledWith('/consult/bookings/c1/change-time', { newSlotId: 's-a' });
        expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ startsAt: slotA.startsAt }));
    });

    it('when someone else took the time, says so and shows fresh times', async () => {
        m.get.mockResolvedValueOnce({ data: [slotA, slotB] }).mockResolvedValueOnce({ data: [slotB] });
        m.post.mockRejectedValue({ response: { status: 409, data: { error: 'That time was just taken. Please pick another.' } } });
        await mount();
        await pickFirstTime();
        await act(async () => byText(/^Move to/).click());
        await flush();
        expect(document.body.textContent).toContain('That time was just taken. Please pick another.');
        expect(m.get).toHaveBeenCalledTimes(2);
        expect(onChanged).not.toHaveBeenCalled();
        expect(byText(/Pick a new time/).disabled).toBe(true);
    });

    it('when the booking itself can no longer move (cutoff passed), hands back to the page', async () => {
        m.get.mockResolvedValue({ data: [slotA] });
        m.post.mockRejectedValue({ response: { status: 409, data: { error: 'The time can be changed only until 2 hours before the start.' } } });
        await mount();
        await pickFirstTime();
        await act(async () => byText(/^Move to/).click());
        await flush();
        expect(onStale).toHaveBeenCalled();
        expect(m.get).toHaveBeenCalledTimes(1);
    });

    it('hides times sooner than the booking\'s lead time', async () => {
        const soon = { id: 's-soon', startsAt: new Date(Date.now() + 30 * 60_000).toISOString(), endsAt: later(1) };
        m.get.mockResolvedValue({ data: [soon] });
        booking.selfReschedule.minLeadMinutes = 60;
        await mount();
        booking.selfReschedule.minLeadMinutes = undefined;
        expect(document.body.textContent).toContain('has no other free times right now');
    });
});

