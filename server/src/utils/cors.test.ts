import cors from 'cors';
import express from 'express';
import type { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';
import { buildCorsOptions } from './corsOptions';

describe('buildCorsOptions', () => {
    it('lets browsers on an allowed origin read the Date header', async () => {
        const app = express();
        app.use(cors(buildCorsOptions(['https://docnow.in'])));
        app.get('/x', (_req, res) => res.json({ ok: true }));
        const server = await new Promise<import('http').Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`;
        const allowed = await fetch(url, { headers: { origin: 'https://docnow.in' } });
        expect(allowed.headers.get('access-control-expose-headers')).toMatch(/Date/i);
        expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');
        const blocked = await fetch(url, { headers: { origin: 'https://evil.example' } });
        expect(blocked.status).toBe(500);
        await new Promise<void>((r) => server.close(() => r()));
    });
});
