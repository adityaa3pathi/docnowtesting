'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Shows the controls on each call to `show`, then hides them after `ms` without activity. */
export function useAutoHide(ms = 3000) {
    const [visible, setVisible] = useState(true);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const show = useCallback(() => {
        setVisible(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setVisible(false), ms);
    }, [ms]);
    useEffect(() => () => clearTimeout(timer.current), []);
    return { visible, show };
}

type IOSVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** iPhone Safari can't make a page element fullscreen, only a video, through its own player. */
export const iosVideoFullscreen = typeof HTMLVideoElement !== 'undefined' && 'webkitEnterFullscreen' in HTMLVideoElement.prototype;

export function useFullscreen(container: RefObject<HTMLElement | null>, video: RefObject<HTMLVideoElement | null>, onEnter: () => void) {
    const [fullscreen, setFullscreen] = useState(false);
    const native = typeof document !== 'undefined' && document.fullscreenEnabled === true;

    useEffect(() => {
        const cb = () => {
            setFullscreen(!!document.fullscreenElement);
            if (document.fullscreenElement) onEnter();
        };
        document.addEventListener('fullscreenchange', cb);
        return () => document.removeEventListener('fullscreenchange', cb);
    }, [onEnter]);

    const toggle = useCallback(() => {
        if (!native) return (video.current as IOSVideo | null)?.webkitEnterFullscreen?.();
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void container.current?.requestFullscreen().catch(() => {});
    }, [native, container, video]);

    return { fullscreen, toggle, native };
}

/** Seconds since `running` first became true; starts again from zero when `resetKey` changes. */
export function useCallTimer(running: boolean, resetKey: number) {
    const [seconds, setSeconds] = useState(0);
    const start = useRef<number | null>(null);

    useEffect(() => {
        start.current = null;
        setSeconds(0);
    }, [resetKey]);

    useEffect(() => {
        if (!running) return;
        start.current ??= Date.now();
        const id = setInterval(() => setSeconds(Math.floor((Date.now() - (start.current ?? Date.now())) / 1000)), 1000);
        return () => clearInterval(id);
    }, [running]);

    return seconds;
}

export function formatDuration(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

/** Offers audio-only once the network has stayed weak for 5 seconds; a short dip shouldn't nag. */
export function useWeakNetworkPrompt(weak: boolean) {
    const [shown, setShown] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => {
        if (!weak) return;
        const t = setTimeout(() => setShown(true), 5000);
        return () => {
            clearTimeout(t);
            setShown(false);
        };
    }, [weak]);
    return { show: shown && !dismissed, dismiss: () => setDismissed(true) };
}

export type ShortcutKey = 'm' | 'v' | 'f';

/** M, V and F shortcuts; skipped while typing or with Ctrl/Cmd/Alt held so browser shortcuts still work. */
export function useCallShortcuts(enabled: boolean, onKey: (key: ShortcutKey) => void) {
    const handler = useRef(onKey);
    useEffect(() => {
        handler.current = onKey;
    });
    useEffect(() => {
        if (!enabled) return;
        function listener(e: KeyboardEvent) {
            if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
            const t = e.target;
            if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
            if (t instanceof HTMLElement && t.isContentEditable) return;
            const key = e.key.toLowerCase();
            if (key !== 'm' && key !== 'v' && key !== 'f') return;
            e.preventDefault();
            handler.current(key);
        }
        window.addEventListener('keydown', listener);
        return () => window.removeEventListener('keydown', listener);
    }, [enabled]);
}

/**
 * Fill the box (crop) unless that would cut away too much: a landscape doctor on a portrait
 * phone would lose two thirds of the picture, so it is shown whole with bars instead.
 */
export function videoFit(videoW: number, videoH: number, boxW: number, boxH: number): 'cover' | 'contain' {
    if (!videoW || !videoH || !boxW || !boxH) return 'cover';
    const ratio = (videoW / videoH) / (boxW / boxH);
    const kept = Math.min(ratio, 1 / ratio);
    return kept < 0.7 ? 'contain' : 'cover';
}
