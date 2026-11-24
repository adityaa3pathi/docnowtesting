// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingReviewState, OwnReview } from '@/lib/consult/types';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get, post: m.post } }));
const { RateDoctorCard } = await import('./RateDoctorCard');
const { Stars } = await import('./reviews');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const open: BookingReviewState = { review: null, canReview: true, closesAt: new Date(Date.now() + 40 * 3_600_000).toISOString() };
const written: OwnReview = {
    id: 'r1', rating: 4, text: 'Kind and clear', createdAt: new Date().toISOString(), editedByDocNow: false, reply: null, status: 'VISIBLE',
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const byText = (re: RegExp) => Array.from(document.body.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''))!;

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
async function mount(node: React.ReactNode) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(node));
}
beforeEach(() => { m.post.mockReset(); });
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe('RateDoctorCard', () => {
    it('asks for stars before sending, then sends rating and trimmed text and shows the review', async () => {
        m.post.mockResolvedValue({ data: written, headers: {} });
        await mount(<RateDoctorCard bookingId="c1" doctorName="Dr Meera" state={open} />);
        expect(host.textContent).toContain('How was your consultation with Dr Meera?');

        await act(async () => byText(/Send review/).click());
        expect(host.textContent).toContain('Choose 1 to 5 stars');
        expect(m.post).not.toHaveBeenCalled();

        const four = host.querySelector('input[value="4"]') as HTMLInputElement;
        await act(async () => four.click());
        const box = host.querySelector('textarea') as HTMLTextAreaElement;
        await act(async () => {
            const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
            set.call(box, '  Kind and clear  ');
            box.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => byText(/Send review/).click());
        await flush();
        expect(m.post).toHaveBeenCalledWith('/consult/bookings/c1/review', { rating: 4, text: 'Kind and clear' });
        expect(host.textContent).toContain('Thanks for rating Dr Meera');
        expect(host.textContent).toContain('Kind and clear');
        expect(host.querySelector('textarea')).toBeNull();
    });

    it('shows the server message when the window has closed', async () => {
        m.post.mockRejectedValue({ response: { data: { error: 'Reviews close 48 hours after the consultation' } } });
        await mount(<RateDoctorCard bookingId="c1" doctorName="Dr Meera" state={open} />);
        await act(async () => (host.querySelector('input[value="5"]') as HTMLInputElement).click());
        await act(async () => byText(/Send review/).click());
        await flush();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('Reviews close 48 hours after the consultation');
    });

    it('shows nothing when reviews are closed and none was written; shows a hidden review with a note', async () => {
        await mount(<RateDoctorCard bookingId="c1" doctorName="Dr Meera" state={{ review: null, canReview: false, closesAt: null }} />);
        expect(host.textContent).toBe('');
        act(() => root.unmount());
        host.remove();
        await mount(<RateDoctorCard bookingId="c1" doctorName="Dr Meera" state={{ review: { ...written, status: 'HIDDEN' }, canReview: false, closesAt: null }} />);
        expect(host.textContent).toContain('not showing this review publicly');
        expect(host.querySelector('form')).toBeNull();
    });
});

describe('Stars', () => {
    it('fills whole and half stars from the average', async () => {
        await mount(<Stars value={3.6} />);
        const widths = Array.from(host.querySelectorAll('span[style]')).map((s) => (s as HTMLElement).style.width);
        expect(widths).toEqual(['100%', '100%', '100%', '50%']);
    });
});
