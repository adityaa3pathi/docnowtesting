/** Plain lines for the refund tiers saved with a booking, nearest-to-furthest notice last. */
export function cancelPolicyLines(tiers: { minHoursBefore: number; percent: number }[]): string[] {
    const sorted = [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
    const hours = (h: number) => `${h} ${h === 1 ? 'hour' : 'hours'}`;
    const refund = (p: number) => (p >= 100 ? 'full refund' : p <= 0 ? 'no refund' : `${p}% refund`);
    return sorted.map((t, i) => {
        const upper = i > 0 ? sorted[i - 1].minHoursBefore : null;
        if (i === 0) return t.minHoursBefore > 0 ? `${hours(t.minHoursBefore)} or more before: ${refund(t.percent)}` : `Any time before: ${refund(t.percent)}`;
        if (t.minHoursBefore <= 0) return `Less than ${hours(upper!)} before: ${refund(t.percent)}`;
        return `${t.minHoursBefore} to ${hours(upper!)} before: ${refund(t.percent)}`;
    });
}
