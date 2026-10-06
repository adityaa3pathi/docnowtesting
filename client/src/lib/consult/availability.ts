/** Pure helpers for weekly hours and leave. All times are Indian time (no daylight saving, always UTC+5:30). */
import type { AvailabilityWindow } from './types';
import { minutesToTime, timeToMinutes, WEEKDAYS } from './time';

export interface TimeRange {
    start: string;
    end: string;
}

/** Index 0 = Sunday, matching the server. */
export type WeekForm = TimeRange[][];

const IST_OFFSET_MS = 330 * 60 * 1000;

export const emptyWeek = (): WeekForm => WEEKDAYS.map(() => []);

export function windowsToForm(windows: AvailabilityWindow[]): WeekForm {
    const week = emptyWeek();
    const sorted = [...windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute);
    for (const w of sorted) week[w.dayOfWeek]?.push({ start: minutesToTime(w.startMinute), end: minutesToTime(w.endMinute) });
    return week;
}

/** Returns a plain-words error, or null when the range is fine. */
export function validateRange(range: TimeRange): string | null {
    const start = timeToMinutes(range.start);
    const end = timeToMinutes(range.end);
    if (start === null || end === null) return 'Enter times like 09:30 (24-hour).';
    if (start >= 1440) return 'Start must be before midnight.';
    if (end <= start) return 'End must be after start.';
    return null;
}

/** True when two ranges share time. Back-to-back ranges (10:00-12:00 and 12:00-14:00) are fine. */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
    const [as, ae, bs, be] = [timeToMinutes(a.start), timeToMinutes(a.end), timeToMinutes(b.start), timeToMinutes(b.end)];
    if (as === null || ae === null || bs === null || be === null) return false;
    return as < be && bs < ae;
}

export interface WeekValidation {
    /** Error per day index, only for days that have one. */
    errors: Record<number, string>;
    windows: AvailabilityWindow[];
}

export function validateWeek(week: WeekForm): WeekValidation {
    const errors: Record<number, string> = {};
    const windows: AvailabilityWindow[] = [];
    week.forEach((ranges, day) => {
        for (const r of ranges) {
            const bad = validateRange(r);
            if (bad) {
                errors[day] ??= bad;
                continue;
            }
            windows.push({ dayOfWeek: day, startMinute: timeToMinutes(r.start)!, endMinute: timeToMinutes(r.end)! });
        }
        if (errors[day]) return;
        for (let i = 0; i < ranges.length; i++) {
            for (let j = i + 1; j < ranges.length; j++) {
                if (rangesOverlap(ranges[i], ranges[j])) {
                    errors[day] = `${WEEKDAYS[day]} has two time ranges that overlap.`;
                    return;
                }
            }
        }
    });
    return { errors, windows };
}

// ── Leave ────────────────────────────────────────────────

/** Turns "2026-10-07T09:00" (as typed in Indian time) into an exact ISO instant. Null if not a date. */
export function istLocalToIso(local: string): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
    if (!m) return null;
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    const ms = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS;
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** The reverse of istLocalToIso, for filling a datetime-local input. */
export function isoToIstLocal(iso: string): string {
    return new Date(Date.parse(iso) + IST_OFFSET_MS).toISOString().slice(0, 16);
}

export function validateLeave(startLocal: string, endLocal: string): { error: string } | { startsAt: string; endsAt: string } {
    const startsAt = istLocalToIso(startLocal);
    const endsAt = istLocalToIso(endLocal);
    if (!startsAt || !endsAt) return { error: 'Choose both a start and an end.' };
    if (Date.parse(endsAt) <= Date.parse(startsAt)) return { error: 'The end must be after the start.' };
    return { startsAt, endsAt };
}
