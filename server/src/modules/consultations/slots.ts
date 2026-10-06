/**
 * Slot computation (pure). All weekly hours are in IST, which has no daylight saving.
 */
export const IST_OFFSET_MINUTES = 330;
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

export type Window = { dayOfWeek: number; startMinute: number; endMinute: number };
export type Leave = { startsAt: Date; endsAt: Date };
export type SlotRange = { startsAt: Date; endsAt: Date };

/** UTC instant of 00:00 IST on the IST calendar day containing `d`. */
export function istDayStart(d: Date): Date {
    const shifted = d.getTime() + IST_OFFSET_MINUTES * MS_PER_MIN;
    const dayStartShifted = Math.floor(shifted / MS_PER_DAY) * MS_PER_DAY;
    return new Date(dayStartShifted - IST_OFFSET_MINUTES * MS_PER_MIN);
}

function istDayOfWeek(dayStart: Date): number {
    return new Date(dayStart.getTime() + IST_OFFSET_MINUTES * MS_PER_MIN).getUTCDay();
}

export function computeSlots(opts: {
    windows: Window[];
    leaves: Leave[];
    slotMinutes: number;
    from: Date;
    days: number;
}): SlotRange[] {
    const { windows, leaves, slotMinutes, from, days } = opts;
    const out: SlotRange[] = [];
    const firstDay = istDayStart(from);

    for (let i = 0; i < days; i++) {
        const dayStart = new Date(firstDay.getTime() + i * MS_PER_DAY);
        const dow = istDayOfWeek(dayStart);

        for (const w of windows.filter((x) => x.dayOfWeek === dow)) {
            for (let m = w.startMinute; m + slotMinutes <= w.endMinute; m += slotMinutes) {
                const startsAt = new Date(dayStart.getTime() + m * MS_PER_MIN);
                const endsAt = new Date(startsAt.getTime() + slotMinutes * MS_PER_MIN);
                if (startsAt <= from) continue;
                if (leaves.some((l) => startsAt < l.endsAt && endsAt > l.startsAt)) continue;
                out.push({ startsAt, endsAt });
            }
        }
    }
    return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Throws if two windows on the same day overlap. */
export function assertNoOverlap(windows: Window[]): void {
    const sorted = [...windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (prev.dayOfWeek === cur.dayOfWeek && cur.startMinute < prev.endMinute) {
            throw new Error('Working hours overlap on the same day');
        }
    }
}
