/**
 * Consultation rules: shape, defaults, validation and refund tier choice. Pure, no database.
 * The ceilings stop a mistaken or hostile edit from holding slots for days or taking most of a fee.
 */
export type RefundTier = { minHoursBefore: number; percent: number };

export type Rules = {
    refundTiers: RefundTier[];
    doctorNoShowWaitMinutes: number;
    patientNoShowWaitMinutes: number;
    doctorNoShowOutcome: 'FULL_REFUND';
    platformFeeBps: number;
    holdMinutes: number;
    minLeadMinutes: number;
    uploadLimitMb: number;
};

export const DEFAULT_RULES: Rules = {
    refundTiers: [
        { minHoursBefore: 24, percent: 100 },
        { minHoursBefore: 6, percent: 50 },
        { minHoursBefore: 0, percent: 0 },
    ],
    doctorNoShowWaitMinutes: 10,
    patientNoShowWaitMinutes: 10,
    doctorNoShowOutcome: 'FULL_REFUND',
    platformFeeBps: 1000,
    holdMinutes: 10,
    minLeadMinutes: 15,
    uploadLimitMb: 10,
};

export const CEILINGS = {
    holdMinutes: { min: 1, max: 30 },
    minLeadMinutes: { min: 5, max: 240 },
    waitMinutes: { min: 1, max: 60 },
    platformFeeBps: { min: 0, max: 5000 },
    uploadLimitMb: { min: 1, max: 50 },
} as const;

const inRange = (n: number, r: { min: number; max: number }) => Number.isInteger(n) && n >= r.min && n <= r.max;

/** Returns the first problem found, or null when the rules are valid. */
export function validateRules(rules: Rules): string | null {
    const tiers = [...rules.refundTiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
    if (tiers.length === 0) return 'At least one refund tier is required';
    for (const t of tiers) {
        if (!Number.isFinite(t.minHoursBefore) || t.minHoursBefore < 0) return 'Tier hours must be zero or more';
        if (!Number.isInteger(t.percent) || t.percent < 0 || t.percent > 100) return 'Refund percent must be a whole number from 0 to 100';
    }
    for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].minHoursBefore === tiers[i - 1].minHoursBefore) return 'Duplicate tier hours';
        if (tiers[i].percent > tiers[i - 1].percent) return 'Refund percent cannot increase as the visit gets closer';
    }
    if (tiers[tiers.length - 1].minHoursBefore !== 0) return 'The last tier must start at 0 hours so every time matches';

    if (!inRange(rules.holdMinutes, CEILINGS.holdMinutes)) return `Hold minutes must be ${CEILINGS.holdMinutes.min} to ${CEILINGS.holdMinutes.max}`;
    if (!inRange(rules.minLeadMinutes, CEILINGS.minLeadMinutes)) return `Lead minutes must be ${CEILINGS.minLeadMinutes.min} to ${CEILINGS.minLeadMinutes.max}`;
    if (!inRange(rules.doctorNoShowWaitMinutes, CEILINGS.waitMinutes) || !inRange(rules.patientNoShowWaitMinutes, CEILINGS.waitMinutes)) {
        return `No-show wait minutes must be ${CEILINGS.waitMinutes.min} to ${CEILINGS.waitMinutes.max}`;
    }
    if (!inRange(rules.platformFeeBps, CEILINGS.platformFeeBps)) return `Fee must be at most ${CEILINGS.platformFeeBps.max / 100} percent`;
    if (!inRange(rules.uploadLimitMb, CEILINGS.uploadLimitMb)) return `Upload limit must be ${CEILINGS.uploadLimitMb.min} to ${CEILINGS.uploadLimitMb.max} MB`;
    return null;
}

/** Hours exactly on a tier boundary count in the higher tier. A visit already started gets the lowest tier. */
export function pickRefundPercent(tiers: RefundTier[], hoursBefore: number): number {
    const sorted = [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
    const match = sorted.find((t) => hoursBefore >= t.minHoursBefore);
    return (match ?? sorted[sorted.length - 1]).percent;
}

/** True when any tier's refund percent falls by 30 points or more, which staff should see at once. */
export function hasSharpRefundDrop(before: Rules, after: Rules, threshold = 30): boolean {
    return before.refundTiers.some((old) => {
        const next = after.refundTiers.find((t) => t.minHoursBefore === old.minHoursBefore);
        const nextPercent = next ? next.percent : pickRefundPercent(after.refundTiers, old.minHoursBefore);
        return old.percent - nextPercent >= threshold;
    });
}
