import { describe, expect, it } from 'vitest';
import { AUTO_END_AFTER_MS, HARD_STOP_MS, closeStaleCalls } from './consultations.staleCalls';
import { FakeVideo } from './test/fakeVideo';

const MIN = 60_000;
const now = new Date('2026-11-24T12:00:00Z');

/** Just enough of Prisma for the sweep: one IN_PROGRESS call the doctor never ended. */
function stubDb(slotEndedMsAgo: number, roomId: string | null = 'room-1') {
    const row = { id: 'c1', doctorId: 'd1', roomId, status: 'IN_PROGRESS', endedAt: null as Date | null, slot: { endsAt: new Date(now.getTime() - slotEndedMsAgo) } };
    const queries: any[] = [];
    const db = {
        consultation: {
            async findMany(args: any) {
                queries.push(args);
                const cutoff: Date = args.where.slot.endsAt.lte;
                return row.status === 'IN_PROGRESS' && row.slot.endsAt <= cutoff ? [row] : [];
            },
            async updateMany(args: any) {
                if (row.status !== args.where.status) return { count: 0 };
                Object.assign(row, args.data);
                return { count: 1 };
            },
        },
    };
    return { db: db as any, row, queries };
}

describe('closeStaleCalls', () => {
    it('only looks at calls both sides joined, with no lookback', async () => {
        const { db, queries } = stubDb(0);
        await closeStaleCalls({ db, video: new FakeVideo(), now });
        expect(queries[0].where).toEqual({
            status: 'IN_PROGRESS',
            patientJoinedAt: { not: null },
            slot: { endsAt: { lte: new Date(now.getTime() - AUTO_END_AFTER_MS) } },
        });
    });

    it('leaves a call inside the chat window', async () => {
        const { db, row } = stubDb(AUTO_END_AFTER_MS - MIN);
        expect(await closeStaleCalls({ db, video: new FakeVideo(), now })).toEqual({ closed: 0, waiting: 0 });
        expect(row.status).toBe('IN_PROGRESS');
    });

    it('completes an empty call and closes its room', async () => {
        const { db, row } = stubDb(AUTO_END_AFTER_MS + MIN);
        const video = new FakeVideo();
        expect(await closeStaleCalls({ db, video, now })).toEqual({ closed: 1, waiting: 0 });
        expect(row).toMatchObject({ status: 'COMPLETED', endedAt: now });
        expect(video.roomsEnded).toEqual(['room-1']);
    });

    it('waits on an occupied room until the hard stop', async () => {
        const video = new FakeVideo();
        video.occupied.add('room-1');
        const early = stubDb(AUTO_END_AFTER_MS + MIN);
        expect(await closeStaleCalls({ db: early.db, video, now })).toEqual({ closed: 0, waiting: 1 });
        expect(video.roomsEnded).toEqual([]);
        const late = stubDb(HARD_STOP_MS);
        expect(await closeStaleCalls({ db: late.db, video, now })).toEqual({ closed: 1, waiting: 0 });
        expect(late.row.status).toBe('COMPLETED');
    });

    it('waits when the room cannot be checked, or the provider cannot check rooms', async () => {
        const failing = new FakeVideo();
        failing.roomOccupied = async () => { throw new Error('livekit down'); };
        expect(await closeStaleCalls({ db: stubDb(AUTO_END_AFTER_MS + MIN).db, video: failing, now })).toEqual({ closed: 0, waiting: 1 });
        const noCheck = new FakeVideo() as any;
        noCheck.roomOccupied = undefined;
        expect(await closeStaleCalls({ db: stubDb(AUTO_END_AFTER_MS + MIN).db, video: noCheck, now })).toEqual({ closed: 0, waiting: 1 });
    });

    it('completes a call with no room without asking the video provider', async () => {
        const { db, row } = stubDb(AUTO_END_AFTER_MS + MIN, null);
        const video = new FakeVideo();
        video.roomOccupied = async () => { throw new Error('should not be called'); };
        expect(await closeStaleCalls({ db, video, now })).toEqual({ closed: 1, waiting: 0 });
        expect(row.status).toBe('COMPLETED');
    });

    it('still completes when closing the room fails', async () => {
        const { db, row } = stubDb(AUTO_END_AFTER_MS + MIN);
        const video = new FakeVideo();
        video.endRoom = async () => { throw new Error('livekit down'); };
        expect(await closeStaleCalls({ db, video, now })).toEqual({ closed: 1, waiting: 0 });
        expect(row.status).toBe('COMPLETED');
    });
});
