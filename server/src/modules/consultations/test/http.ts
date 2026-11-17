/** Small HTTP helper: serve a router on a random port and sign test tokens. */
import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';

export const TEST_JWT_SECRET = 'consult-test-secret';

/** Call before importing any module that loads the auth middleware. */
export function useTestJwtSecret() {
    process.env.JWT_SECRET = process.env.JWT_SECRET || TEST_JWT_SECRET;
    // Empty values stop dotenv from filling real Upstash settings, so rate limits stay in memory.
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    // Blank Razorpay credentials so no test can reach the real API with keys from .env.
    process.env.RAZORPAY_KEY_ID = '';
    process.env.RAZORPAY_KEY_SECRET = '';
    process.env.RAZORPAY_WEBHOOK_SECRET = '';
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
        const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
