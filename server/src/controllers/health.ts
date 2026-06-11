import { Request, Response } from 'express';
import {
    buildHealthResponse,
    checkDatabase,
    checkHealthians,
    checkRedis,
    checkS3,
    getWebhookHealthSummary,
} from '../services/healthCheck';
import { addObservabilityBreadcrumb } from '../utils/sentry';

function hasValidHealthcheckSecret(req: Request) {
    const expected = process.env.HEALTHCHECK_SECRET;
    if (!expected) return false;

    const provided = req.headers['x-healthcheck-secret'];
    return typeof provided === 'string' && provided === expected;
}

export function live(req: Request, res: Response) {
    res.json({
        status: 'ok',
        checkedAt: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
    });
}

export async function ready(req: Request, res: Response) {
    const startedAt = Date.now();
    const checks = [await checkDatabase()];
    const payload = buildHealthResponse(checks, startedAt);

    res.status(payload.status === 'down' ? 503 : 200).json(payload);
}

export async function deep(req: Request, res: Response) {
    if (!hasValidHealthcheckSecret(req)) {
        return res.status(401).json({ error: 'Unauthorized health check' });
    }

    const startedAt = Date.now();
    const checks = await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkS3(),
        checkHealthians(),
    ]);
    const payload = buildHealthResponse(checks, startedAt);

    res.status(payload.status === 'down' ? 503 : 200).json(payload);
}

export async function webhookSummary(req: Request, res: Response) {
    if (!hasValidHealthcheckSecret(req)) {
        return res.status(401).json({ error: 'Unauthorized health check' });
    }

    const payload = await getWebhookHealthSummary();

    addObservabilityBreadcrumb('webhook_health_summary_requested', {
        razorpayTotal: payload.razorpay.total,
        healthiansTotal: payload.healthians.total,
        healthiansProcessed: payload.healthians.processed,
        failedCount: payload.healthians.recentUnprocessed.length,
    });

    res.json(payload);
}
