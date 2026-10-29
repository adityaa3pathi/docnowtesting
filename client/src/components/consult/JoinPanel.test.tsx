// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JoinPanel } from './JoinPanel';

vi.mock('./ConsultCallRoom', () => ({ ConsultCallRoom: () => <div data-testid="call-room" /> }));

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
});

function mount(join: () => Promise<never>, consentDoctorName?: string) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    // Two minutes before the start: the room is open.
    const startsAt = new Date(Date.now() + 2 * 60_000).toISOString();
    const endsAt = new Date(Date.now() + 17 * 60_000).toISOString();
    act(() => root!.render(<JoinPanel status="CONFIRMED" type="VIDEO" startsAt={startsAt} endsAt={endsAt} otherParty="doctor" join={join} consentDoctorName={consentDoctorName} />));
    return host;
}

const joinButton = (el: HTMLElement) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Join call'))!;

describe('JoinPanel telemedicine consent', () => {
    it('keeps Join disabled until the patient ticks the NMC consent', async () => {
        const join = vi.fn(() => new Promise<never>(() => {}));
        const el = mount(join, 'Mehta');
        expect(el.textContent).toContain('I consent to an online telemedicine video consultation with Dr. Mehta in accordance with the National Medical Commission (NMC) Telemedicine Practice Guidelines.');
        expect(el.textContent).toContain('Please accept teleconsultation consent to join');
        expect(joinButton(el).disabled).toBe(true);

        act(() => (el.querySelector('[data-testid="consent-checkbox"]') as HTMLInputElement).click());
        expect(joinButton(el).disabled).toBe(false);
        expect(el.textContent).not.toContain('Please accept teleconsultation consent to join');
        await act(async () => joinButton(el).click());
        expect(join).toHaveBeenCalledTimes(1);
    });

    it('shows no consent box on the doctor side', () => {
        const el = mount(vi.fn(() => new Promise<never>(() => {})));
        expect(el.querySelector('[data-testid="consent-checkbox"]')).toBeNull();
        expect(joinButton(el).disabled).toBe(false);
    });
});
