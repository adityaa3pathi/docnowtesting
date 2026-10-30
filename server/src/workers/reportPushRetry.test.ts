import { describe, expect, it, vi } from 'vitest';
import { RETRY_BACKOFF_MS, retryFailedReportPushes, STALE_SENDING_MS } from './reportPushRetry';

const NOW = new Date('2026-10-30T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const row = (reportId: string, attempts: number, updatedAt: Date) => ({ reportId, attempts, updatedAt, report: { booking: { userId: `user-${reportId}` } } });

function fakeDb(rows: ReturnType<typeof row>[], staleCount = 0) {
    return {
        reportNotification: {
            updateMany: vi.fn().mockResolvedValue({ count: staleCount }),
            findMany: vi.fn().mockResolvedValue(rows),
        },
    };
}

describe('retryFailedReportPushes', () => {
    it('retries failed pushes for the report owner once their backoff has passed', async () => {
        const db = fakeDb([row('r1', 1, ago(RETRY_BACKOFF_MS + 1)), row('r2', 2, ago(2 * RETRY_BACKOFF_MS + 1))]);
        const send = vi.fn().mockResolvedValue('sent');
        const out = await retryFailedReportPushes({ db: db as never, now: NOW, send });
        expect(send.mock.calls).toEqual([['r1', 'user-r1'], ['r2', 'user-r2']]);
        expect(out).toMatchObject({ retried: 2, sent: 2, failed: 0 });
    });

    it('waits longer after each attempt', async () => {
        // Second attempt failed 6 minutes ago: past the first backoff, not yet past 2 × backoff.
        const db = fakeDb([row('r1', 2, ago(RETRY_BACKOFF_MS + 60_000))]);
        const send = vi.fn().mockResolvedValue('sent');
        await retryFailedReportPushes({ db: db as never, now: NOW, send });
        expect(send).not.toHaveBeenCalled();
    });

    it('asks only for FAILED push rows under the attempt cap, inside the retry window', async () => {
        const db = fakeDb([]);
        await retryFailedReportPushes({ db: db as never, now: NOW, send: vi.fn() });
        expect(db.reportNotification.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ channel: 'push', status: 'FAILED', attempts: { lt: 3 }, updatedAt: { lt: ago(RETRY_BACKOFF_MS) } }),
            }),
        );
    });

    it('takes back rows abandoned mid-send so they are retried, not lost', async () => {
        const db = fakeDb([], 2);
        const out = await retryFailedReportPushes({ db: db as never, now: NOW, send: vi.fn() });
        expect(db.reportNotification.updateMany).toHaveBeenCalledWith({
            where: { channel: 'push', status: 'SENDING', updatedAt: { lt: ago(STALE_SENDING_MS) } },
            data: { status: 'FAILED', lastError: 'Abandoned while sending' },
        });
        expect(out.recovered).toBe(2);
    });

    it('counts a retry that failed again', async () => {
        const db = fakeDb([row('r1', 1, ago(RETRY_BACKOFF_MS + 1))]);
        const out = await retryFailedReportPushes({ db: db as never, now: NOW, send: vi.fn().mockResolvedValue('failed') });
        expect(out).toMatchObject({ retried: 1, sent: 0, failed: 1 });
    });
});
