import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpoMessage, ExpoTicket } from './expoPush';
import { reportReadyMessage, sendReportReadyPush } from './reportPush';

const okSend = () => vi.fn(async (msgs: ExpoMessage[]): Promise<ExpoTicket[]> => msgs.map((_, i) => ({ status: 'ok', id: `t${i}` })));

function fakeDb(tokens: string[], opts: { claimTaken?: boolean; retryable?: boolean } = {}) {
    return {
        pushToken: {
            findMany: vi.fn().mockResolvedValue(tokens.map((token) => ({ token }))),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reportNotification: {
            create: opts.claimTaken
                ? vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }))
                : vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({ count: opts.retryable ? 1 : 0 }),
            update: vi.fn().mockResolvedValue({}),
        },
    };
}

afterEach(() => {
    delete process.env.EXPO_PUSH_DISABLED;
});

describe('report ready message', () => {
    it('deep-links to the in-app viewer on the prescriptions-reports channel', () => {
        expect(reportReadyMessage('rep-123')).toEqual({
            title: 'Your Lab Report is Ready',
            body: 'Your test results are now available to view and download.',
            data: { url: 'docnow://records/report/rep-123', channelId: 'prescriptions-reports', type: 'LAB_REPORT_READY', reportId: 'rep-123' },
            channelId: 'prescriptions-reports',
            sound: 'default',
            priority: 'high',
            ttl: 604800,
        });
    });
});

describe('sendReportReadyPush', () => {
    it('claims the report, sends to every phone and records the tickets', async () => {
        const db = fakeDb(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
        const send = okSend();
        expect(await sendReportReadyPush('rep-1', 'user-1', { db: db as never, send })).toBe('sent');
        expect(db.pushToken.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1' }, select: { token: true } });
        expect(db.reportNotification.create).toHaveBeenCalledWith({ data: { reportId: 'rep-1', channel: 'push' } });
        expect(send.mock.calls[0]?.[0].map((m) => m.to)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
        expect(db.reportNotification.update).toHaveBeenCalledWith({
            where: { reportId_channel: { reportId: 'rep-1', channel: 'push' } },
            data: { status: 'SENT', providerId: 't0,t1', lastError: null },
        });
    });

    it('fires at most once per report: a second ingestion finds it claimed', async () => {
        const db = fakeDb(['ExponentPushToken[a]'], { claimTaken: true });
        const send = okSend();
        expect(await sendReportReadyPush('rep-1', 'user-1', { db: db as never, send })).toBe('already-sent');
        expect(send).not.toHaveBeenCalled();
    });

    it('retries a failed send on a later ingestion', async () => {
        const db = fakeDb(['ExponentPushToken[a]'], { claimTaken: true, retryable: true });
        expect(await sendReportReadyPush('rep-1', 'user-1', { db: db as never, send: okSend() })).toBe('sent');
    });

    it('claims nothing when the person has no phone registered', async () => {
        const db = fakeDb([]);
        expect(await sendReportReadyPush('rep-1', 'user-1', { db: db as never, send: okSend() })).toBe('no-devices');
        expect(db.reportNotification.create).not.toHaveBeenCalled();
    });

    it('records the failure and never throws when Expo is down', async () => {
        const db = fakeDb(['ExponentPushToken[a]']);
        const send = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
        expect(await sendReportReadyPush('rep-1', 'user-1', { db: db as never, send })).toBe('failed');
        expect(db.reportNotification.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED', lastError: 'ECONNRESET' } }));
    });

    it('forgets an uninstalled phone', async () => {
        const db = fakeDb(['ExponentPushToken[gone]', 'ExponentPushToken[live]']);
        const send = vi.fn(async (): Promise<ExpoTicket[]> => [
            { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
            { status: 'ok', id: 't1' },
        ]);
        expect(await sendReportReadyPush('rep-1', 'user-1', { db: db as never, send })).toBe('sent');
        expect(db.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ['ExponentPushToken[gone]'] } } });
    });

    it('is off when push is disabled and no sender is injected', async () => {
        process.env.EXPO_PUSH_DISABLED = '1';
        const db = fakeDb(['ExponentPushToken[a]']);
        expect(await sendReportReadyPush('rep-1', 'user-1', { db: db as never })).toBe('disabled');
        expect(db.pushToken.findMany).not.toHaveBeenCalled();
    });
});
