/** All slot and hours text is shown in Indian time, whatever the device's time zone is. */
const IST = 'Asia/Kolkata';

const dayLabel = new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true });
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });
const fullLabel = new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export const formatIstDay = (iso: string) => dayLabel.format(new Date(iso));
export const formatIstTime = (iso: string) => timeLabel.format(new Date(iso)).toUpperCase();
export const formatIstDateTime = (iso: string) => fullLabel.format(new Date(iso));
/** A stable key such as 2026-10-07 for the Indian calendar day of an instant. */
export const istDayKey = (iso: string) => dayKeyFormat.format(new Date(iso));

export interface DaySlots<T> {
    key: string;
    label: string;
    slots: T[];
}

/** Groups slots by Indian day, in time order. Days with no slots do not appear. */
export function groupSlotsByDay<T extends { startsAt: string }>(slots: T[]): DaySlots<T>[] {
    const days = new Map<string, DaySlots<T>>();
    const sorted = [...slots].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    for (const slot of sorted) {
        const key = istDayKey(slot.startsAt);
        if (!days.has(key)) days.set(key, { key, label: formatIstDay(slot.startsAt), slots: [] });
        days.get(key)!.slots.push(slot);
    }
    return [...days.values()];
}

/** Minutes after midnight to 24-hour text, for time inputs. 600 becomes 10:00. */
export function minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 24-hour text to minutes after midnight. Returns null for text that is not a time. */
export function timeToMinutes(text: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
    return h * 60 + m;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// ── Server clock ─────────────────────────────────────────

let serverOffsetMs = 0;

/** Remembers how far the device clock is from the server's, read from a response Date header. */
export function recordServerDate(dateHeader: string | undefined | null, deviceNow = Date.now()) {
    if (!dateHeader) return;
    const server = Date.parse(dateHeader);
    if (Number.isNaN(server)) return;
    serverOffsetMs = server - deviceNow;
}

export function serverNow(deviceNow = Date.now()): number {
    return deviceNow + serverOffsetMs;
}

/** Whole seconds left until an instant, on the server's clock. Never below zero. */
export function secondsUntil(iso: string, deviceNow = Date.now()): number {
    return Math.max(0, Math.ceil((Date.parse(iso) - serverNow(deviceNow)) / 1000));
}

export function resetServerClockForTests() {
    serverOffsetMs = 0;
}
