/** Rules text and slot choice for changing a booking's time. Pure, so it can be tested. */
import type { SelfReschedule, Slot } from './types';

/** 120 → "2 hours", 90 → "90 minutes". Must match the server's cutoffText. */
export function cutoffText(minutes: number): string {
    if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
    return `${minutes} minutes`;
}

/** "Free. Same doctor. Until 2 hours before the start. 1 of 2 changes left." */
export function changeTimeRules(r: SelfReschedule): string {
    const left = Math.max(0, r.max - r.used);
    return `Free, with the same doctor, until ${cutoffText(r.cutoffMinutes)} before the start. ${left} of ${r.max} ${r.max === 1 ? 'change' : 'changes'} left.`;
}

/** Free times (the public list has only free ones) the booking can move to: not the current one, far enough ahead. */
export function movableSlots(slots: Slot[], currentStartsAt: string, nowMs: number, leadMinutes = 15): Slot[] {
    const current = Date.parse(currentStartsAt);
    return slots.filter((s) => Date.parse(s.startsAt) !== current && Date.parse(s.startsAt) > nowMs + leadMinutes * 60_000);
}
