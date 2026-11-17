// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeviceCheckScreen } from './DeviceCheckScreen';

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
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
});

function fakeTrack(kind: 'audio' | 'video', deviceId: string) {
    return { kind, stop: vi.fn(), getSettings: () => ({ deviceId }) };
}

function fakeStream() {
    const audio = fakeTrack('audio', 'mic-1');
    const video = fakeTrack('video', 'cam-1');
    return {
        audio, video,
        stream: { getTracks: () => [audio, video], getAudioTracks: () => [audio], getVideoTracks: () => [video] },
    };
}

function stubMedia(getUserMedia: () => Promise<unknown>) {
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia: vi.fn(getUserMedia),
            enumerateDevices: vi.fn(async () => [
                { kind: 'videoinput', deviceId: 'cam-1', label: 'Front' },
                { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in' },
            ]),
        },
    });
    class FakeAudioContext {
        createAnalyser() {
            return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 4, getByteFrequencyData: () => {} };
        }
        createMediaStreamSource() {
            return { connect: () => {} };
        }
        close() {
            return Promise.resolve();
        }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('requestAnimationFrame', () => 0);
}

function mount(onJoin = vi.fn()) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<DeviceCheckScreen videoAllowed joining={false} onJoin={onJoin} onCancel={() => {}} />));
    return host;
}

const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('DeviceCheckScreen', () => {
    it('lets the user join anyway when the browser has no camera access', async () => {
        const onJoin = vi.fn();
        const el = mount(onJoin);
        await act(async () => {});
        expect(el.textContent).toContain('We could not check your camera and microphone.');
        act(() => button(el, 'Join anyway')!.click());
        expect(onJoin).toHaveBeenCalledWith({});
    });

    it('asks for permission itself and passes on the devices it opened', async () => {
        const { stream } = fakeStream();
        stubMedia(async () => stream);
        const onJoin = vi.fn();
        const el = mount(onJoin);
        await act(async () => {});
        expect((el.querySelector('video') as HTMLVideoElement & { srcObject: unknown }).srcObject).toBe(stream);
        act(() => button(el, 'Join call')!.click());
        expect(onJoin).toHaveBeenCalledWith({ audioDeviceId: 'mic-1', videoDeviceId: 'cam-1' });
    });

    it('stops a camera that starts after the screen has closed', async () => {
        let resolve: (s: unknown) => void = () => {};
        const { stream, audio, video } = fakeStream();
        stubMedia(() => new Promise((r) => (resolve = r)));
        mount();
        act(() => root!.unmount());
        root = null;
        await act(async () => resolve(stream));
        expect(video.stop).toHaveBeenCalled();
        expect(audio.stop).toHaveBeenCalled();
    });
});
