import { Redis } from '@upstash/redis';
import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';

export type HealthStatus = 'ok' | 'degraded' | 'down';
export type CheckStatus = HealthStatus | 'skipped';

export interface DependencyCheck {
    name: string;
    status: CheckStatus;
    durationMs: number;
    message?: string;
}

export interface HealthResponse {
    status: HealthStatus;
    checkedAt: string;
    durationMs: number;
    checks: DependencyCheck[];
}

export interface WebhookHealthSummary {
    status: HealthStatus;
    windowHours: number;
    checkedAt: string;
    razorpay: {
        total: number;
    };
    healthians: {
        total: number;
        processed: number;
        unprocessed: number;
        eventTypeCounts: Array<{ eventType: string; count: number }>;
        recentUnprocessed: Array<{
            id: string;
            eventType: string | null;
            bookingId: string | null;
            createdAt: Date;
        }>;
    };
}

function messageFromError(error: unknown) {
    return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
        promise
            .then((value) => {
                clearTimeout(timeout);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timeout);
                reject(error);
            });
    });
}

export function buildHealthResponse(checks: DependencyCheck[], startedAt = Date.now()): HealthResponse {
    const hasDown = checks.some((check) => check.status === 'down');
    const hasDegraded = checks.some((check) => check.status === 'degraded');

    return {
        status: hasDown ? 'down' : hasDegraded ? 'degraded' : 'ok',
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        checks,
    };
}

export async function runCheck(name: string, fn: () => Promise<void>, timeoutMs = 3000): Promise<DependencyCheck> {
    const startedAt = Date.now();
    try {
        await withTimeout(fn(), timeoutMs, name);
        return { name, status: 'ok', durationMs: Date.now() - startedAt };
    } catch (error) {
        return {
            name,
            status: 'down',
            durationMs: Date.now() - startedAt,
            message: messageFromError(error),
        };
    }
}

export async function checkDatabase() {
    return runCheck('database', async () => {
        await prisma.$queryRaw`SELECT 1`;
    });
}

export async function checkRedis() {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        return { name: 'redis', status: 'skipped', durationMs: 0, message: 'Upstash Redis is not configured' } as DependencyCheck;
    }

    return runCheck('redis', async () => {
        const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL!,
            token: process.env.UPSTASH_REDIS_REST_TOKEN!,
        });
        await redis.ping();
    });
}

export async function checkS3() {
    return runCheck('s3', async () => {
        const { reportStorage } = await import('./reportStorage');
        await reportStorage.exists('__healthcheck__');
    });
}

export async function checkHealthians() {
    return runCheck('healthians', async () => {
        const adapter = HealthiansAdapter.getInstance();
        await adapter.getActiveZipcodes();
    }, 5000);
}

type WebhookSummaryClient = Pick<typeof prisma, 'webhookEvent' | 'webhookEventV2'>;

export async function getWebhookHealthSummary(
    client: WebhookSummaryClient = prisma,
    windowHours = 24,
): Promise<WebhookHealthSummary> {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const [
        razorpayTotal,
        healthiansTotal,
        healthiansProcessed,
        recentHealthiansFailures,
        healthiansEventTypes,
    ] = await Promise.all([
        client.webhookEvent.count({ where: { createdAt: { gte: since } } }),
        client.webhookEventV2.count({ where: { source: 'healthians', createdAt: { gte: since } } }),
        client.webhookEventV2.count({ where: { source: 'healthians', processed: true, createdAt: { gte: since } } }),
        client.webhookEventV2.findMany({
            where: { source: 'healthians', processed: false, createdAt: { gte: since } },
            select: { id: true, eventType: true, bookingId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
        }),
        client.webhookEventV2.groupBy({
            by: ['eventType'],
            where: { source: 'healthians', createdAt: { gte: since } },
            _count: { eventType: true },
        }),
    ]);

    return {
        status: recentHealthiansFailures.length > 0 ? 'degraded' : 'ok',
        windowHours,
        checkedAt: new Date().toISOString(),
        razorpay: { total: razorpayTotal },
        healthians: {
            total: healthiansTotal,
            processed: healthiansProcessed,
            unprocessed: Math.max(0, healthiansTotal - healthiansProcessed),
            eventTypeCounts: healthiansEventTypes.map((row) => ({
                eventType: row.eventType || 'unknown',
                count: row._count.eventType,
            })),
            recentUnprocessed: recentHealthiansFailures,
        },
    };
}
