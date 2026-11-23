/**
 * Where a promo code works, as the admin promo form sends it. Doctor and specialty limits are for
 * consultations, so a lab-only code never carries any (the server refuses them).
 */
export type PromoAppliesTo = 'LAB' | 'CONSULT' | 'BOTH';

export const APPLIES_TO_LABEL: Record<PromoAppliesTo, string> = {
    LAB: 'Lab tests',
    CONSULT: 'Doctor consultations',
    BOTH: 'Lab tests and consultations',
};

export function promoScopePayload(appliesTo: PromoAppliesTo, doctorIds: string[], specialtyIds: string[]) {
    if (appliesTo === 'LAB') return { appliesTo, doctorIds: [], specialtyIds: [] };
    return { appliesTo, doctorIds: [...new Set(doctorIds)], specialtyIds: [...new Set(specialtyIds)] };
}

/** One line for the promo list: where it works and any consultation limits. */
export function promoScopeSummary(p: { appliesTo?: PromoAppliesTo; scopes?: { doctor?: { displayName: string } | null; specialty?: { name: string } | null }[] }): string {
    const where = APPLIES_TO_LABEL[p.appliesTo ?? 'LAB'];
    const names = (p.scopes ?? []).map((s) => s.doctor?.displayName ?? s.specialty?.name).filter(Boolean) as string[];
    if (names.length === 0) return where;
    const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2} more` : '');
    return `${where} · only ${shown}`;
}
