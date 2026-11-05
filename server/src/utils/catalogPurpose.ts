export const PURPOSE_MAX_LENGTH = 300;

type PurposeResult = { ok: true; value: string | null } | { ok: false; error: string };

// Manager-written "What it's for" text. Blank clears it.
export function normalizePurpose(input: unknown): PurposeResult {
    if (input === null) return { ok: true, value: null };
    if (typeof input !== 'string') return { ok: false, error: 'purpose must be text or null' };

    const value = input.trim();
    if (value.length > PURPOSE_MAX_LENGTH) {
        return { ok: false, error: `purpose must be ${PURPOSE_MAX_LENGTH} characters or fewer` };
    }
    return { ok: true, value: value || null };
}
