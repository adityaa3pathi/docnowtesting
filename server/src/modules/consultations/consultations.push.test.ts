import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { duePushes, pushMessage, sendDuePushes, type ExpoMessage, type ExpoTicket, type PushRow } from './consultations.push';

const START = new Date('2026-11-02T10:00:00.000Z'); // 3:30 PM IST
const min = (m: number) => new Date(START.getTime() + m * 60_000);

function row(over: Partial<PushRow> = {}): PushRow {
    return {
        id: 'c-1',
        status: 'CONFIRMED',
        startsAt: START,
        createdAt: new Date(START.getTime() - 3 * 86_400_000),
        userId: 'patient-user',
        doctorJoinedAt: null,
        patientJoinedAt: null,
        slot: { endsAt: min(15) },
        doctor: { displayName: 'Mehta', userId: 'doctor-user' },
        refunds: [],
        prescriptions: [],
        ...over,
    } as PushRow;
}

function fakeDb(rows: PushRow[], tokens: { userId: string; token: string }[], opts: { claimTaken?: boolean } = {}) {
    return {
        consultation: { findMany: vi.fn().mockResolvedValue(rows) },
        pushToken: {
            findMany: vi.fn().mockResolvedValue(tokens),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        consultationNotification: {
            create: opts.claimTaken
                ? vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }))
                : vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            update: vi.fn().mockResolvedValue({}),
        },
    };
}

const okSend = () => vi.fn(async (msgs: ExpoMessage[]): Promise<ExpoTicket[]> => msgs.map((_, i) => ({ status: 'ok', id: `ticket-${i}` })));

afterEach(() => {
    delete process.env.EXPO_PUSH_DISABLED;
});

describe('what is due', () => {
    it('uses the WhatsApp rules: partner waiting nudges only the one missing', () => {
        const due = duePushes(row({ status: 'WAITING', patientJoinedAt: min(-2) }), min(-1));
        expect(due).toContainEqual(['PARTNER_WAITING', 'doctor']);
        expect(due).not.toContainEqual(['PARTNER_WAITING', 'patient']);
    });

    it('adds the prescription push once one is issued', () => {
        const done = row({ status: 'COMPLETED', prescriptions: [{ id: 'rx-1' }] });
        expect(duePushes(done, min(30))).toEqual([['PRESCRIPTION_ISSUED', 'patient']]);
        expect(duePushes(row({ status: 'COMPLETED' }), min(30))).toEqual([]);
    });
});

describe('message content', () => {
    it('calls ring on the teleconsult-call channel and deep-link into the right screen', () => {
        const toDoctor = pushMessage('PARTNER_WAITING', 'doctor', row());
        expect(toDoctor).toMatchObject({
            channelId: 'teleconsult-call',
            sound: 'teleconsult_call.wav',
            priority: 'high',
            interruptionLevel: 'time-sensitive',
            data: { url: 'docnow://doctor/consultations/c-1', channelId: 'teleconsult-call', kind: 'PARTNER_WAITING' },
        });
        expect(pushMessage('PARTNER_WAITING', 'patient', row()).data.url).toBe('docnow://consult/room/c-1');
    });

    it('sends prescriptions on the clinical channel, linking to the prescription', () => {
        expect(pushMessage('PRESCRIPTION_ISSUED', 'patient', row())).toMatchObject({
            channelId: 'prescriptions-reports',
            data: { url: 'docnow://records/prescription/c-1' },
        });
    });

    it('reminders use the quiet channel, and times are in IST', () => {
        const m = pushMessage('REMINDER', 'patient', row());
        expect(m.channelId).toBe('reminders');
        expect(m.sound).toBe('default');
        expect(m.body).toContain('3:30 PM IST');
    });

    it('carries only routing data, never health or patient details', () => {
        for (const kind of ['REMINDER', 'JOIN_NOW', 'PARTNER_WAITING', 'PRESCRIPTION_ISSUED'] as const) {
            expect(Object.keys(pushMessage(kind, 'doctor', row()).data).sort()).toEqual(['channelId', 'consultationId', 'kind', 'url']);
        }
    });
});

describe('sendDuePushes', () => {
    const waiting = row({ status: 'WAITING', patientJoinedAt: min(-2) });

    it('sends to every phone of the recipient and records the tickets', async () => {
        const db = fakeDb([waiting], [
            { userId: 'doctor-user', token: 'ExponentPushToken[a]' },
            { userId: 'doctor-user', token: 'ExponentPushToken[b]' },
        ]);
        const send = okSend();
        const out = await sendDuePushes({ db: db as never, now: min(-1), send });

        const toDoctor = send.mock.calls.map((c) => c[0]).find((msgs) => msgs[0]?.data.kind === 'PARTNER_WAITING');
        expect(toDoctor?.map((m) => m.to)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
        expect(db.consultationNotification.create).toHaveBeenCalledWith({
            data: { consultationId: 'c-1', kind: 'PARTNER_WAITING', recipient: 'doctor', channel: 'push' },
        });
        expect(db.consultationNotification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: 'SENT', providerId: 'ticket-0,ticket-1', lastError: null } }),
        );
        expect(out.failed).toBe(0);
        expect(out.sent).toBeGreaterThan(0);
    });

    it('claims nothing for someone with no registered phone', async () => {
        const db = fakeDb([waiting], []);
        const send = okSend();
        expect(await sendDuePushes({ db: db as never, now: min(-1), send })).toEqual({ sent: 0, failed: 0 });
        expect(db.consultationNotification.create).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('does not send what another run already claimed', async () => {
        const db = fakeDb([waiting], [{ userId: 'doctor-user', token: 'ExponentPushToken[a]' }], { claimTaken: true });
        const send = okSend();
        await sendDuePushes({ db: db as never, now: min(-1), send });
        expect(send).not.toHaveBeenCalled();
    });

    it('forgets uninstalled phones and still counts the send if one phone got it', async () => {
        const db = fakeDb([row({ status: 'COMPLETED', prescriptions: [{ id: 'rx' }] })], [
            { userId: 'patient-user', token: 'ExponentPushToken[gone]' },
            { userId: 'patient-user', token: 'ExponentPushToken[live]' },
        ]);
        const send = vi.fn(async (): Promise<ExpoTicket[]> => [
            { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
            { status: 'ok', id: 't-live' },
        ]);
        const out = await sendDuePushes({ db: db as never, now: min(30), send });
        expect(db.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ['ExponentPushToken[gone]'] } } });
        expect(out).toEqual({ sent: 1, failed: 0 });
    });

    it('marks the notice FAILED (to retry) when every phone was refused or Expo is down', async () => {
        const db = fakeDb([row({ status: 'COMPLETED', prescriptions: [{ id: 'rx' }] })], [{ userId: 'patient-user', token: 'ExponentPushToken[a]' }]);
        const send = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
        const out = await sendDuePushes({ db: db as never, now: min(30), send });
        expect(out).toEqual({ sent: 0, failed: 1 });
        expect(db.consultationNotification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: 'FAILED', lastError: 'ECONNRESET' } }),
        );
    });

    it('scopes an immediate kick to one consultation', async () => {
        const db = fakeDb([], []);
        await sendDuePushes({ db: db as never, now: min(0), send: okSend(), consultationId: 'c-9' });
        expect(db.consultation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'c-9' }) }));
    });

    it('does nothing when push is switched off and no sender is injected', async () => {
        process.env.EXPO_PUSH_DISABLED = '1';
        const db = fakeDb([waiting], [{ userId: 'doctor-user', token: 'ExponentPushToken[a]' }]);
        expect(await sendDuePushes({ db: db as never })).toEqual({ sent: 0, failed: 0 });
        expect(db.consultation.findMany).not.toHaveBeenCalled();
    });
});
