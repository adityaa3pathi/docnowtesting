// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConnectionError } from 'livekit-client';
import { callCopy } from './callCopy';
import { ControlBar } from './ControlBar';
import { classifyConnectError } from './useCallRoom';
import { formatDuration, useCallShortcuts, useWeakNetworkPrompt, type ShortcutKey } from './useCallUi';
import { WaitingRoom } from './WaitingRoom';

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
    vi.useRealTimers();
});

function mount(ui: React.ReactNode) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(ui));
    return host;
}

const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('classifyConnectError', () => {
    it('uses LiveKit reason codes, not message text', () => {
        expect(classifyConnectError(ConnectionError.notAllowed('anything', 401))).toBe('expired');
        expect(classifyConnectError(ConnectionError.timeout('token in message'))).toBe('network');
        expect(classifyConnectError(new Error('network token timeout'))).toBe('unknown');
    });
});

describe('formatDuration', () => {
    it('shows minutes and padded seconds', () => {
        expect(formatDuration(0)).toBe('0:00');
        expect(formatDuration(65)).toBe('1:05');
        expect(formatDuration(3600)).toBe('60:00');
    });
});

describe('ControlBar', () => {
    const base = {
        copy: callCopy('en'), connected: true, micOn: true, camOn: true, videoAllowed: true, canFlip: false,
        canFullscreen: true, fullscreen: false, canPip: false, leaving: false,
        onMic: () => {}, onCamera: () => {}, onFlip: () => {}, onFullscreen: () => {}, onPip: () => {},
    };

    it('asks before leaving, and Stay keeps the call', () => {
        const onAskLeave = vi.fn();
        const onLeave = vi.fn();
        const el = mount(<ControlBar {...base} confirmingLeave={false} onAskLeave={onAskLeave} onLeave={onLeave} />);
        act(() => button(el, 'Leave')!.click());
        expect(onAskLeave).toHaveBeenCalledWith(true);
        expect(onLeave).not.toHaveBeenCalled();

        act(() => root!.render(<ControlBar {...base} confirmingLeave onAskLeave={onAskLeave} onLeave={onLeave} />));
        expect(el.textContent).toContain('Leave the call?');
        act(() => button(el, 'Stay')!.click());
        expect(onAskLeave).toHaveBeenLastCalledWith(false);
        act(() => button(el, 'Yes, leave')!.click());
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('shows Hindi labels and hides flip when there is one camera', () => {
        const el = mount(<ControlBar {...base} copy={callCopy('hi')} confirmingLeave={false} onAskLeave={() => {}} onLeave={() => {}} />);
        expect(el.textContent).toContain('माइक बंद करें');
        expect(el.textContent).not.toContain('कैमरा बदलें');
    });
});

describe('WaitingRoom', () => {
    it('offers support after 10 minutes, only to the patient side', () => {
        vi.useFakeTimers();
        const el = mount(<WaitingRoom otherParty="doctor" copy={callCopy('en')} />);
        expect(el.textContent).not.toContain('running late');
        act(() => vi.advanceTimersByTime(10 * 60_000));
        expect(el.textContent).toContain('running late');
        expect(el.querySelector('a[href^="tel:"]')).not.toBeNull();

        act(() => root!.render(<WaitingRoom key="doctor-side" otherParty="patient" copy={callCopy("en")} />));
        act(() => vi.advanceTimersByTime(10 * 60_000));
        expect(el.textContent).not.toContain('running late');
    });
});

describe('useWeakNetworkPrompt', () => {
    function Probe({ weak }: { weak: boolean }) {
        const p = useWeakNetworkPrompt(weak);
        return <button onClick={p.dismiss}>{p.show ? 'shown' : 'hidden'}</button>;
    }

    it('waits 5 seconds of weak network, resets on recovery, and stays dismissed', () => {
        vi.useFakeTimers();
        const el = mount(<Probe weak />);
        act(() => vi.advanceTimersByTime(4_000));
        expect(el.textContent).toBe('hidden');
        act(() => vi.advanceTimersByTime(1_000));
        expect(el.textContent).toBe('shown');

        act(() => root!.render(<Probe weak={false} />));
        expect(el.textContent).toBe('hidden');
        act(() => root!.render(<Probe weak />));
        act(() => vi.advanceTimersByTime(5_000));
        act(() => el.querySelector('button')!.click());
        expect(el.textContent).toBe('hidden');
    });
});

describe('useCallShortcuts', () => {
    function Probe({ onKey }: { onKey: (k: ShortcutKey) => void }) {
        useCallShortcuts(true, onKey);
        return <input />;
    }
    const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
        act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init })));

    it('fires on M/V/F but not with Ctrl/Cmd or while typing', () => {
        const onKey = vi.fn();
        const el = mount(<Probe onKey={onKey} />);
        press('m');
        press('F');
        press('f', { ctrlKey: true });
        press('v', { metaKey: true });
        press('m', {}, el.querySelector('input')!);
        press('x');
        expect(onKey.mock.calls).toEqual([['m'], ['f']]);
    });
});
