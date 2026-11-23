// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import api, { loginRedirect } from '@/lib/api';
import { AuthProvider, useAuth } from './AuthContext';

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
});

/** The real API client and interceptor, with the server scripted per URL. */
function script(routes: Record<string, number[]>) {
    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
        const status = routes[config.url ?? '']?.shift() ?? 500;
        const res = { data: {}, status, statusText: '', headers: {}, config };
        throw Object.assign(new Error(`HTTP ${status}`), { config, response: res });
    };
    api.defaults.adapter = adapter;
}

function Probe() {
    const { isInitialized, user } = useAuth();
    return <output data-initialized={String(isInitialized)} data-user={user ? 'signed-in' : 'guest'} />;
}

describe('AuthProvider', () => {
    it('lets a guest who lands on an inner page stay there (no session, so /auth/me and refresh are 401)', async () => {
        const go = vi.spyOn(loginRedirect, 'go').mockImplementation(() => {});
        window.history.replaceState(null, '', '/search');
        script({ '/auth/me': [401], '/auth/refresh': [401] });

        const host = document.createElement('div');
        const root = createRoot(host);
        await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
        await act(async () => {});

        expect(go).not.toHaveBeenCalled();
        const probe = host.querySelector('output')!;
        expect(probe.dataset.initialized).toBe('true');
        expect(probe.dataset.user).toBe('guest');
        act(() => root.unmount());
    });
});
