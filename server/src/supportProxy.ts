import type { Express } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { rateLimiter } from './middleware/rateLimiter';

/** Header that proves to FastAPI the call came through this proxy (and its rate limits). */
export const SUPPORT_PROXY_SECRET_HEADER = 'x-docnow-support-proxy';

/** AI_SUPPORT_URL with or without the /api/support suffix → the FastAPI /api/support base. */
export function supportTarget(rawUrl: string): string {
    const base = rawUrl.replace(/\/+$/, '');
    return base.endsWith('/api/support') ? base : `${base}/api/support`;
}

/**
 * Mounts /api/support on the AI service.
 *
 * Each chat message costs several Gemini calls, so chat turns are capped per caller. The limiters sit
 * on /api/support/chat, which also matches the streaming route /api/support/chat/stream: both share
 * one per-minute and one per-day budget.
 *
 * Responses are piped through as they arrive, so the stream's status events are not held back here.
 * The AI service sends Cache-Control: no-cache, no-transform and X-Accel-Buffering: no on the stream,
 * which pass through to Nginx in front of Express. If the browser goes away, the upstream request is
 * closed too, and the AI service cancels the turn (unless a booking write has started).
 */
export function mountSupportProxy(app: Express, opts: { target: string; secret: string }) {
    app.use('/api/support/chat', rateLimiter(10, 60, 'support_chat_min'), rateLimiter(100, 24 * 60 * 60, 'support_chat_day'));

    app.use('/api/support', createProxyMiddleware({
        target: opts.target,
        changeOrigin: true,
        timeout: 60000,
        proxyTimeout: 60000,
        on: {
            proxyReq: (proxyReq, req) => {
                // Set before the body is written, or the header never reaches FastAPI.
                if (opts.secret) {
                    proxyReq.setHeader(SUPPORT_PROXY_SECRET_HEADER, opts.secret);
                }
                // express.json() already read the body; resend it or the AI gets nothing and the call times out.
                fixRequestBody(proxyReq, req);
            },
        },
    }));
}
