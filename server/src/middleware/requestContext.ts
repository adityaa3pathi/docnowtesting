import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger, withRequestContext } from '../utils/logger';

type RequestWithContext = Request & {
    requestId?: string;
    userId?: string;
};

function resolveRequestId(req: Request) {
    const incoming = req.headers['x-request-id'];
    if (typeof incoming === 'string' && incoming.trim()) {
        return incoming.trim().slice(0, 128);
    }
    return randomUUID();
}

export function requestContextMiddleware(req: RequestWithContext, res: Response, next: NextFunction) {
    const requestId = resolveRequestId(req);
    const startedAt = process.hrtime.bigint();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    withRequestContext({ requestId }, () => {
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            const logMeta = {
                method: req.method,
                path: req.originalUrl || req.url,
                statusCode: res.statusCode,
                durationMs: Math.round(durationMs),
                userId: req.userId,
            };

            if (res.statusCode >= 500) {
                logger.error(logMeta, 'request_failed');
            } else if (res.statusCode >= 400) {
                logger.warn(logMeta, 'request_completed_with_client_error');
            } else {
                logger.info(logMeta, 'request_completed');
            }
        });

        next();
    });
}
