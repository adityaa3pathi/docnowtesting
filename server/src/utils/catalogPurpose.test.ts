import { describe, expect, it } from 'vitest';
import { normalizePurpose, PURPOSE_MAX_LENGTH } from './catalogPurpose';

describe('normalizePurpose', () => {
    it('trims surrounding spaces', () => {
        expect(normalizePurpose('  Yearly check  ')).toEqual({ ok: true, value: 'Yearly check' });
    });

    it('turns blank input and null into null', () => {
        expect(normalizePurpose('')).toEqual({ ok: true, value: null });
        expect(normalizePurpose('   ')).toEqual({ ok: true, value: null });
        expect(normalizePurpose(null)).toEqual({ ok: true, value: null });
    });

    it('accepts exactly the max length and rejects one more', () => {
        expect(normalizePurpose('a'.repeat(PURPOSE_MAX_LENGTH))).toEqual({ ok: true, value: 'a'.repeat(PURPOSE_MAX_LENGTH) });
        expect(normalizePurpose('a'.repeat(PURPOSE_MAX_LENGTH + 1)).ok).toBe(false);
    });

    it('measures length after trimming', () => {
        expect(normalizePurpose(` ${'a'.repeat(PURPOSE_MAX_LENGTH)} `).ok).toBe(true);
    });

    it('rejects non-string values', () => {
        expect(normalizePurpose(42).ok).toBe(false);
        expect(normalizePurpose({ text: 'x' }).ok).toBe(false);
        expect(normalizePurpose(undefined).ok).toBe(false);
    });
});
