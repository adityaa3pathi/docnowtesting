/**
 * Hours a doctor was online for instant consults (P10c), per IST calendar day. Read by the super-admin
 * "Online now" page and, later, by P13 payroll: both call presenceHours, so there is one definition
 * of "time online".
 *
 * A session counts from startedAt to endedAt. A session still open counts up to now while the doctor's
 * panel keeps checking in; one whose panel went quiet counts only to its last check-in (the same end
 * closeStalePresences writes when it closes it). Sessions are split at IST midnight and clipped to the
 * range asked for.
 */
import type { PrismaClient } from '@prisma/client';
import { INSTANT } from './consultations.instant';

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
export const PRESENCE_MAX_DAYS = 93;

/** IST calendar day (YYYY-MM-DD) of an instant. */
export const istDayOf = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
/** The instant an IST calendar day starts. */
export const istDayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_MS);

export type PresenceSession = {
    id: string;
    startedAt: Date;
    /** Where this session's counted time ends: endedAt, or (open) now / the last check-in. */
    countedUntil: Date;
    open: boolean;
    endReason: string | null;
    seconds: number;
};
/** `sessions` counts sessions that touched this day: one crossing IST midnight counts on both days. */
export type PresenceDay = { day: string; seconds: number; sessions: number };
export type DoctorPresenceHours = {
    doctorId: string;
    doctorName: string;
    totalSeconds: number;
    days: PresenceDay[];
    sessions: PresenceSession[];
};

type Row = { id: string; startedAt: Date; lastSeenAt: Date; endedAt: Date | null; endReason: string | null };

/** Where a session's counted time ends. */
export function sessionEnd(p: Pick<Row, 'lastSeenAt' | 'endedAt'>, now: Date): Date {
    if (p.endedAt) return p.endedAt;
    return p.lastSeenAt.getTime() < now.getTime() - INSTANT.presenceTimeoutMs ? p.lastSeenAt : now;
}

/** Seconds of [start, end) on each IST day, inside [from, to). */
export function splitByIstDay(start: Date, end: Date, from: Date, to: Date): Map<string, number> {
    const out = new Map<string, number>();
    let a = Math.max(start.getTime(), from.getTime());
    const b = Math.min(end.getTime(), to.getTime());
    while (a < b) {
        const day = istDayOf(new Date(a));
        const next = Math.min(b, istDayStart(day).getTime() + DAY_MS);
        out.set(day, (out.get(day) ?? 0) + (next - a) / 1000);
        a = next;
    }
    return out;
}

export class PresenceRangeError extends Error {}

/** Checks a YYYY-MM-DD range (inclusive, IST days) and returns its instants. */
export function presenceRange(fromDay: string, toDay: string) {
    const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && istDayOf(istDayStart(d)) === d;
    if (!ok(fromDay) || !ok(toDay)) throw new PresenceRangeError('Dates must be YYYY-MM-DD');
    const from = istDayStart(fromDay);
    const to = new Date(istDayStart(toDay).getTime() + DAY_MS);
    if (to <= from) throw new PresenceRangeError('The end date is before the start date');
    if ((to.getTime() - from.getTime()) / DAY_MS > PRESENCE_MAX_DAYS) throw new PresenceRangeError(`At most ${PRESENCE_MAX_DAYS} days at a time`);
    return { from, to };
}

/**
 * Online time per doctor per IST day between fromDay and toDay (inclusive). Time after `now` is
 * never counted. Doctors with no time in the range are left out.
 */
export async function presenceHours(
    db: Pick<PrismaClient, 'doctorPresence'>,
    input: { fromDay: string; toDay: string; doctorIds?: string[]; now?: Date },
): Promise<DoctorPresenceHours[]> {
    const now = input.now ?? new Date();
    const { from, to } = presenceRange(input.fromDay, input.toDay);
    const until = new Date(Math.min(to.getTime(), now.getTime()));
    if (until <= from) return [];
    const rows = await db.doctorPresence.findMany({
        where: {
            ...(input.doctorIds ? { doctorId: { in: input.doctorIds } } : {}),
            startedAt: { lt: until },
            OR: [{ endedAt: null }, { endedAt: { gt: from } }],
        },
        orderBy: { startedAt: 'asc' },
        select: { id: true, doctorId: true, startedAt: true, lastSeenAt: true, endedAt: true, endReason: true, doctor: { select: { displayName: true } } },
    });

    const byDoctor = new Map<string, DoctorPresenceHours & { dayMap: Map<string, PresenceDay> }>();
    for (const r of rows) {
        const end = sessionEnd(r, now);
        const parts = splitByIstDay(r.startedAt, end, from, until);
        if (parts.size === 0) continue;
        let d = byDoctor.get(r.doctorId);
        if (!d) {
            d = { doctorId: r.doctorId, doctorName: r.doctor.displayName, totalSeconds: 0, days: [], sessions: [], dayMap: new Map() };
            byDoctor.set(r.doctorId, d);
        }
        let seconds = 0;
        for (const [day, s] of parts) {
            const pd = d.dayMap.get(day) ?? { day, seconds: 0, sessions: 0 };
            pd.seconds += s;
            pd.sessions += 1;
            d.dayMap.set(day, pd);
            seconds += s;
        }
        d.totalSeconds += seconds;
        d.sessions.push({ id: r.id, startedAt: r.startedAt, countedUntil: end, open: !r.endedAt, endReason: r.endReason, seconds: Math.round(seconds) });
    }
    return [...byDoctor.values()]
        .map(({ dayMap, ...d }) => ({
            ...d,
            totalSeconds: Math.round(d.totalSeconds),
            days: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)).map((x) => ({ ...x, seconds: Math.round(x.seconds) })),
        }))
        .sort((a, b) => b.totalSeconds - a.totalSeconds || a.doctorName.localeCompare(b.doctorName));
}
