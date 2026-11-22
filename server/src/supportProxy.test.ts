import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { mountSupportProxy, supportTarget } from './supportProxy';

/** A stand-in for the FastAPI service: SSE on /chat/stream, JSON on /chat. */
function fakeAiService(opts: { holdMs: number }) {
    const seen = { bodies: [] as unknown[], secrets: [] as (string | undefined)[], closedAt: 0, finished: false };
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            seen.bodies.push(raw ? JSON.parse(raw) : null);
            seen.secrets.push(req.headers['x-docnow-support-proxy'] as string | undefined);
            if (req.url?.endsWith('/chat/stream')) {
                res.writeHead(200, {
                    'content-type': 'text/event-stream',
                    'cache-control': 'no-cache, no-transform',
                    'x-accel-buffering': 'no',
                });
                res.write('event: start\ndata: {"conversation_id": "c1"}\n\n');
                res.write('event: status\ndata: {"stage": "searching"}\n\n');
                const timer = setTimeout(() => {
                    res.end('event: final\ndata: {"content": "done"}\n\n');
                    seen.finished = true;
                }, opts.holdMs);
                res.on('close', () => {
                    clearTimeout(timer);
                    seen.closedAt = Date.now();
                });
            } else {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ content: 'ok' }));
            }
        });
    });
    return { server, seen };
}

async function listen(server: http.Server): Promise<string> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const servers: http.Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
});

async function setup(holdMs: number) {
    const ai = fakeAiService({ holdMs });
    servers.push(ai.server);
    const aiUrl = await listen(ai.server);
    const app = express();
    app.use(express.json());
    // The limiter keys on the user id (else the IP); a fresh id per test keeps the budgets apart.
    const caller = `test-${Math.random()}`;
    app.use((req, _res, next) => { (req as unknown as { userId: string }).userId = caller; next(); });
    mountSupportProxy(app, { target: supportTarget(aiUrl), secret: 'shh' });
    const proxy = http.createServer(app);
    servers.push(proxy);
    return { seen: ai.seen, base: await listen(proxy) };
}

describe('support proxy', () => {
    it('builds the FastAPI target with or without the /api/support suffix', () => {
        expect(supportTarget('https://x.onrender.com/')).toBe('https://x.onrender.com/api/support');
        expect(supportTarget('https://x.onrender.com/api/support')).toBe('https://x.onrender.com/api/support');
    });

    it('passes stream events through as they are sent, with the body, secret and no-buffer headers', async () => {
        const { seen, base } = await setup(1500);
        const t0 = Date.now();
        const res = await fetch(`${base}/api/support/chat/stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'hi', conversation_id: null }),
        });
        expect(res.headers.get('content-type')).toBe('text/event-stream');
        expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
        expect(res.headers.get('x-accel-buffering')).toBe('no');

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        const first = decoder.decode((await reader.read()).value);
        const firstAt = Date.now() - t0;
        let rest = '';
        for (let r = await reader.read(); !r.done; r = await reader.read()) rest += decoder.decode(r.value);
        const doneAt = Date.now() - t0;

        expect(first).toContain('event: start');
        // Not held until the turn ends: relative, so a loaded CI box can't flake it.
        expect(doneAt).toBeGreaterThanOrEqual(1500);
        expect(doneAt - firstAt).toBeGreaterThan(1000);
        expect(first + rest).toContain('event: final');
        expect(seen.bodies[0]).toEqual({ message: 'hi', conversation_id: null });
        expect(seen.secrets[0]).toBe('shh');
    });

    it('closes the upstream request when the browser goes away, so the AI service can cancel the turn', async () => {
        const { seen, base } = await setup(5000);
        const abort = new AbortController();
        const res = await fetch(`${base}/api/support/chat/stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'hi' }),
            signal: abort.signal,
        });
        await res.body!.getReader().read();
        const abortedAt = Date.now();
        abort.abort();
        for (let i = 0; i < 50 && !seen.closedAt; i++) await new Promise((r) => setTimeout(r, 20));
        expect(seen.closedAt).toBeGreaterThan(0);
        expect(seen.closedAt - abortedAt).toBeLessThan(1000);
        expect(seen.finished).toBe(false);
    });

    it('counts the streaming route against the same chat limit as the JSON route', async () => {
        const { base } = await setup(0);
        const post = (path: string) => fetch(`${base}/api/support/${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'hi' }),
        }).then(async (r) => { await r.text(); return r.status; });

        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) statuses.push(await post('chat'));
        for (let i = 0; i < 5; i++) statuses.push(await post('chat/stream'));
        statuses.push(await post('chat/stream'));
        expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
        expect(statuses[10]).toBe(429);
    });
});
