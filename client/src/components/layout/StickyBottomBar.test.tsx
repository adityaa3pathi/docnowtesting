// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StickyBottomBar } from './StickyBottomBar';

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('StickyBottomBar', () => {
    it('publishes its height so the support chat sits above it, and clears it on unmount', () => {
        const callbacks: (() => void)[] = [];
        vi.stubGlobal('ResizeObserver', class {
            constructor(cb: () => void) { callbacks.push(cb); }
            observe() {}
            disconnect() {}
        });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 72 });
        const host = document.createElement('div');
        const root = createRoot(host);
        act(() => root.render(<StickyBottomBar className="z-50">bar</StickyBottomBar>));
        act(() => callbacks.forEach((cb) => cb()));
        expect(document.documentElement.style.getPropertyValue('--sticky-bottom')).toBe('72px');
        act(() => root.unmount());
        expect(document.documentElement.style.getPropertyValue('--sticky-bottom')).toBe('0px');
        vi.unstubAllGlobals();
    });
});
