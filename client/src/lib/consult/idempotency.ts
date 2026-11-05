/**
 * One key per booking attempt (slot plus person). A repeat of the same attempt reuses it, so the
 * server returns the same order. After a dead booking the key is forgotten, so the next try is fresh.
 */
const PREFIX = 'consult-attempt:';

function storage(): Storage | null {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
}

function newKey(): string {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `k_${id.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 64);
}

export function attemptKey(slotId: string, patientId: string): string {
    const store = storage();
    const name = `${PREFIX}${slotId}:${patientId}`;
    const existing = store?.getItem(name);
    if (existing) return existing;
    const key = newKey();
    store?.setItem(name, key);
    return key;
}

export function forgetAttemptKey(slotId: string, patientId: string) {
    storage()?.removeItem(`${PREFIX}${slotId}:${patientId}`);
}
