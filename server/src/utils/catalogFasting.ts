// Manager correction of the fasting facts Healthians sends. Healthians data is copied into
// detailsData on every details fetch, so a correction lives in its own columns that sync never writes.

export const FASTING_VALUES = ['Required', 'Not Required'] as const;
export type FastingValue = (typeof FASTING_VALUES)[number];
export const MAX_FASTING_HOURS = 24;

export interface FastingOverride {
    fastingOverride: FastingValue | null;
    fastingTimeOverride: string | null;
}

type OverrideResult = { ok: true; value: FastingOverride } | { ok: false; error: string };

// Same wording as Healthians ("12 hour(s)"), so cards, detail pages and the AI read it unchanged.
export function formatFastingHours(hours: number): string {
    return `${hours} hour(s)`;
}

/** Body { fasting: "Required" | "Not Required" | null, fastingHours?: number | null }; null fasting removes the correction. */
export function normalizeFastingOverride(body: unknown): OverrideResult {
    if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
    const { fasting, fastingHours } = body as { fasting?: unknown; fastingHours?: unknown };

    if (fasting === null) {
        if (fastingHours !== undefined && fastingHours !== null) {
            return { ok: false, error: 'fastingHours needs fasting "Required"' };
        }
        return { ok: true, value: { fastingOverride: null, fastingTimeOverride: null } };
    }
    if (typeof fasting !== 'string' || !(FASTING_VALUES as readonly string[]).includes(fasting)) {
        return { ok: false, error: 'fasting must be "Required", "Not Required" or null' };
    }
    if (fasting === 'Not Required') {
        if (fastingHours !== undefined && fastingHours !== null) {
            return { ok: false, error: 'fastingHours is only allowed when fasting is "Required"' };
        }
        return { ok: true, value: { fastingOverride: 'Not Required', fastingTimeOverride: null } };
    }
    if (fastingHours === undefined || fastingHours === null) {
        return { ok: true, value: { fastingOverride: 'Required', fastingTimeOverride: null } };
    }
    if (typeof fastingHours !== 'number' || !Number.isInteger(fastingHours) || fastingHours < 1 || fastingHours > MAX_FASTING_HOURS) {
        return { ok: false, error: `fastingHours must be a whole number from 1 to ${MAX_FASTING_HOURS}` };
    }
    return { ok: true, value: { fastingOverride: 'Required', fastingTimeOverride: formatFastingHours(fastingHours) } };
}

/** What customers see: the manager's correction when there is one, otherwise Healthians' values. */
export function effectiveFasting(
    partner: { fasting?: string | null; fastingTime?: string | null } | null | undefined,
    item: { fastingOverride?: string | null; fastingTimeOverride?: string | null },
): { fasting: string | null; fastingTime: string | null; corrected: boolean } {
    if (item.fastingOverride) {
        return {
            fasting: item.fastingOverride,
            fastingTime: item.fastingOverride === 'Required' ? item.fastingTimeOverride ?? null : null,
            corrected: true,
        };
    }
    return { fasting: partner?.fasting ?? null, fastingTime: partner?.fastingTime ?? null, corrected: false };
}

/** Patch a raw Healthians product-details response (snake_case) with the correction, without mutating the cached copy. */
export function applyFastingOverrideToPartnerDetails<T>(details: T, item: FastingOverride | null): T {
    const data = (details as { data?: Record<string, unknown> } | null)?.data;
    if (!item?.fastingOverride || !data || typeof data !== 'object') return details;
    const fixed = effectiveFasting(null, item);
    return { ...details, data: { ...data, fasting: fixed.fasting, fasting_time: fixed.fastingTime } };
}
