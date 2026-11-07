// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import api from './api';

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

afterEach(() => window.history.replaceState(null, '', '/'));

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
