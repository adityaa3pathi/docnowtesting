/** When a patient may change their consultation's time. Pure, no database. */
import { rulesOf } from './consultations.policy';

/** Statuses a patient can move: paid and not started. WAITING means they are already in the room. */
const SELF_MOVABLE = ['CONFIRMED'] as const;

export type SelfReschedule = {
    allowed: boolean;
    /** Why not, in words for the patient; null when allowed. */
    reason: string | null;
    used: number;
    max: number;
    cutoffMinutes: number;
    /** How soon a new time may start, from the booking's rules (the picker filters with it). */
    minLeadMinutes: number;
    /** The last moment a move is accepted. */
    deadline: Date;
};

/** Whether this booking can be moved now, from the rules copied at booking. Pure. */
export function selfRescheduleState(
    c: { status: string; startsAt: Date; rescheduleCount: number; policySnapshot: unknown; reviewReason?: string | null },
    now: Date,
): SelfReschedule {
    const rules = rulesOf(c.policySnapshot);
    const deadline = new Date(c.startsAt.getTime() - rules.rescheduleCutoffMinutes * 60_000);
    const base = { used: c.rescheduleCount, max: rules.maxReschedules, cutoffMinutes: rules.rescheduleCutoffMinutes, minLeadMinutes: rules.minLeadMinutes, deadline };
    const no = (reason: string) => ({ ...base, allowed: false, reason });
    if (!(SELF_MOVABLE as readonly string[]).includes(c.status)) return no('Only a confirmed consultation that has not started can be moved.');
    if (c.reviewReason) return no('Our team is checking this booking. Please contact support to change the time.');
    if (rules.maxReschedules === 0) return no('Changing the time is not available for this booking.');
    if (c.rescheduleCount >= rules.maxReschedules) {
        return no(`You have already changed the time ${rules.maxReschedules === 1 ? 'once' : `${rules.maxReschedules} times`}, the most allowed.`);
    }
    if (now.getTime() >= deadline.getTime()) return no(`The time can be changed only until ${cutoffText(rules.rescheduleCutoffMinutes)} before the start.`);
    return { ...base, allowed: true, reason: null };
}

/** 120 → "2 hours", 90 → "90 minutes". */
export function cutoffText(minutes: number): string {
    if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
    return `${minutes} minutes`;
}
