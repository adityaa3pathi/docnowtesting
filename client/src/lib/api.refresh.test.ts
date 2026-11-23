// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import api, { loginRedirect } from './api';

type Reply = { status: number; data?: unknown } | 'offline';

/** Answers each URL from its own queue, so a test scripts the server one call at a time. */
function script(routes: Record<string, Reply[]>): string[] {
    const calls: string[] = [];
    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
        const url = config.url ?? '';
        calls.push(url);
        const reply = routes[url]?.shift();
        if (!reply || reply === 'offline') throw Object.assign(new Error('Network Error'), { config });
        const res = { data: reply.data ?? {}, status: reply.status, statusText: '', headers: {}, config };
        if (reply.status >= 400) throw Object.assign(new Error(`HTTP ${reply.status}`), { config, response: res });
        return res;
    };
    api.defaults.adapter = adapter;
    return calls;
}

afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
});

describe('expired session', () => {
    it('sends the visitor to the login page when a request fails and the refresh is refused', async () => {
        const go = vi.spyOn(loginRedirect, 'go').mockImplementation(() => {});
        window.history.replaceState(null, '', '/profile');
        script({ '/profile/patients': [{ status: 401 }], '/auth/refresh': [{ status: 401 }] });
        await expect(api.get('/profile/patients')).rejects.toMatchObject({ response: { status: 401 } });
        expect(go).toHaveBeenCalledTimes(1);
    });

    it('keeps a guest on the page when a skipLoginRedirect request (the /auth/me probe) gets 401', async () => {
        const go = vi.spyOn(loginRedirect, 'go').mockImplementation(() => {});
        window.history.replaceState(null, '', '/search');
        const calls = script({ '/auth/me': [{ status: 401 }], '/auth/refresh': [{ status: 401 }] });
        await expect(api.get('/auth/me', { skipLoginRedirect: true })).rejects.toMatchObject({ response: { status: 401 } });
        expect(calls).toEqual(['/auth/me', '/auth/refresh']);
        expect(go).not.toHaveBeenCalled();
    });

    it('still refreshes a signed-in user on the probe and retries it', async () => {
        const go = vi.spyOn(loginRedirect, 'go').mockImplementation(() => {});
        window.history.replaceState(null, '', '/search');
        const calls = script({
            '/auth/me': [{ status: 401 }, { status: 200, data: { user: { id: 'u1' } } }],
            '/auth/refresh': [{ status: 200, data: { accessToken: 'fresh' } }],
        });
        const res = await api.get('/auth/me', { skipLoginRedirect: true });
        expect(res.data).toEqual({ user: { id: 'u1' } });
        expect(calls).toEqual(['/auth/me', '/auth/refresh', '/auth/me']);
        expect(go).not.toHaveBeenCalled();
    });
});

describe('silent refresh', () => {
    it('treats a 409 (another tab already refreshed) as success and retries the request', async () => {
        window.history.replaceState(null, '', '/cart');
        const calls = script({ '/cart': [{ status: 401 }, { status: 200, data: { ok: true } }], '/auth/refresh': [{ status: 409 }] });
        const res = await api.get('/cart');
        expect(res.data).toEqual({ ok: true });
        expect(calls).toEqual(['/cart', '/auth/refresh', '/cart']);
        expect(window.location.pathname).toBe('/cart');
    });

    it('does not log out when the refresh call itself hits a network error', async () => {
        window.history.replaceState(null, '', '/cart');
        script({ '/cart': [{ status: 401 }], '/auth/refresh': ['offline'] });
        await expect(api.get('/cart')).rejects.toMatchObject({ isNetworkError: true });
        expect(window.location.pathname).toBe('/cart');
    });
});
