/** Client copy of the server's rules checks, so the form can show every problem live. */
import type { ConsultRules, RefundTier } from './types';

export const CEILINGS = {
    holdMinutes: { min: 1, max: 30 },
    minLeadMinutes: { min: 5, max: 240 },
    waitMinutes: { min: 1, max: 60 },
    platformFeeBps: { min: 0, max: 5000 },
    uploadLimitMb: { min: 1, max: 50 },
} as const;

const inRange = (n: number, r: { min: number; max: number }) => Number.isInteger(n) && n >= r.min && n <= r.max;

/** One plain message per problem; an empty list means the rules are valid. */
export function validateRules(rules: ConsultRules): string[] {
    const problems: string[] = [];
    const tiers = [...rules.refundTiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);

    if (tiers.length === 0) {
        problems.push('Add at least one refund tier.');
    } else {
        if (tiers.some((t) => !Number.isFinite(t.minHoursBefore) || t.minHoursBefore < 0)) {
            problems.push('Tier hours must be zero or more.');
        }
        if (tiers.some((t) => !Number.isInteger(t.percent) || t.percent < 0 || t.percent > 100)) {
            problems.push('Refund percent must be a whole number from 0 to 100.');
        }
        if (tiers.some((t, i) => i > 0 && t.minHoursBefore === tiers[i - 1].minHoursBefore)) {
            problems.push('Two tiers have the same hours. Each tier needs different hours.');
        }
        if (tiers.some((t, i) => i > 0 && t.minHoursBefore !== tiers[i - 1].minHoursBefore && t.percent > tiers[i - 1].percent)) {
            problems.push('Refund percent cannot go up as the visit gets closer.');
        }
        if (tiers[tiers.length - 1].minHoursBefore !== 0) {
            problems.push('The last tier must start at 0 hours so every time is covered.');
        }
    }

    const { holdMinutes: h, minLeadMinutes: l, waitMinutes: w, platformFeeBps: f, uploadLimitMb: u } = CEILINGS;
    if (!inRange(rules.holdMinutes, h)) problems.push(`Hold time must be a whole number from ${h.min} to ${h.max} minutes.`);
    if (!inRange(rules.minLeadMinutes, l)) problems.push(`Booking lead time must be a whole number from ${l.min} to ${l.max} minutes.`);
    if (!inRange(rules.doctorNoShowWaitMinutes, w)) problems.push(`Doctor no-show wait must be a whole number from ${w.min} to ${w.max} minutes.`);
    if (!inRange(rules.patientNoShowWaitMinutes, w)) problems.push(`Patient no-show wait must be a whole number from ${w.min} to ${w.max} minutes.`);
    if (!inRange(rules.platformFeeBps, f)) problems.push(`Platform fee must be a whole number of basis points, at most ${f.max} (${f.max / 100} percent).`);
    if (!inRange(rules.uploadLimitMb, u)) problems.push(`Upload limit must be a whole number from ${u.min} to ${u.max} MB.`);
    return problems;
}

/** True when the active version is no longer the one the form loaded. */
export function versionChanged(loadedVersion: number, activeVersion: number): boolean {
    return loadedVersion !== activeVersion;
}

export const sortTiers = (tiers: RefundTier[]): RefundTier[] => [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
