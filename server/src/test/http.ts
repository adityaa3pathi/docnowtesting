/** Small HTTP helper: serve a router on a random port and sign test tokens. */
import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';

export const TEST_JWT_SECRET = 'docnow-test-secret';

/** Call before importing any module that loads the auth middleware. */
export function useTestJwtSecret() {
    process.env.JWT_SECRET = process.env.JWT_SECRET || TEST_JWT_SECRET;
}

export function tokenFor(user: { id: string; tokenVersion: number }) {
    return jwt.sign({ userId: user.id, tokenVersion: user.tokenVersion }, process.env.JWT_SECRET!);
}

export async function serve(mountPath: string, router: Router) {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(mountPath, router);
    const server = await new Promise<import('http').Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export const getJson = async (url: string, token?: string) => {
    const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.status, body: await res.json().catch(() => null) as any };
};

export const postJson = async (url: string, body: unknown, token?: string, headers: Record<string, string> = {}) => {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) as any };
};
