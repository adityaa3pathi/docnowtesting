/**
 * Closes calls the doctor never ended. Only the doctor ends a call (endConsultation), so a doctor
 * who just closes the tab leaves it IN_PROGRESS for ever: never COMPLETED, so never reviewable and
 * never counted as done. Both sides joined, so it was a real consultation and it completes.
 *
 * Once the in-call chat window has passed (CHAT_GRACE_MS after the slot), a call whose video room
 * is empty is completed. A room someone is still in is left alone until HARD_STOP_MS, so a long
 * consultation is never cut off mid-sentence; past that it completes whatever the room says.
 */
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert, logBusinessEvent } from '../../utils/logger';
import { CHAT_GRACE_MS } from './consultations.chat';
import { ConsultVideo, realConsultVideo } from './consultations.video';

type Deps = { db?: PrismaClient; video?: ConsultVideo; now?: Date };

export const AUTO_END_AFTER_MS = CHAT_GRACE_MS;
export const HARD_STOP_MS = 3 * 3_600_000;
const BATCH = 100;

export async function closeStaleCalls(deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    let video: ConsultVideo | null = deps.video ?? null;
    let closed = 0;
    let waiting = 0;

    // No lookback: calls left open before this sweep existed are closed too.
    const candidates = await db.consultation.findMany({
        where: {
            status: 'IN_PROGRESS',
            patientJoinedAt: { not: null },
            slot: { endsAt: { lte: new Date(now.getTime() - AUTO_END_AFTER_MS) } },
        },
        select: { id: true, doctorId: true, roomId: true, slot: { select: { endsAt: true } } },
        orderBy: { startsAt: 'asc' },
        take: BATCH,
    });

    for (const c of candidates) {
        const forced = now.getTime() >= c.slot.endsAt.getTime() + HARD_STOP_MS;
        if (!forced && c.roomId) {
            try {
                video ??= realConsultVideo();
                // Without an occupancy check, wait for the hard stop rather than guess.
                const occupied = video.roomOccupied ? await video.roomOccupied(c.roomId) : true;
                if (occupied) { waiting++; continue; }
            } catch (e) {
                // Video not reachable or not set up: same as occupied, the hard stop still applies.
                logAlert('consult_stale_call_room_check_failed', { consultationId: c.id, error: e });
                waiting++;
                continue;
            }
        }

        const res = await db.consultation.updateMany({
            where: { id: c.id, status: 'IN_PROGRESS', patientJoinedAt: { not: null } },
            data: { status: 'COMPLETED', endedAt: now },
        });
        if (res.count !== 1) continue; // the doctor ended it in the meantime
        closed++;
        logBusinessEvent('consult_call_auto_ended', { consultationId: c.id, doctorId: c.doctorId, forced });
        if (c.roomId) {
            try {
                video ??= realConsultVideo();
                // Already complete; a room left open only shows a stale call screen and empties itself.
                await video.endRoom(c.roomId);
            } catch (e) {
                console.error('[Consult] end room failed:', e);
            }
        }
    }

    return { closed, waiting };
}
