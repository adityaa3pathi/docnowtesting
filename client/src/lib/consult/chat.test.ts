import { describe, expect, it } from 'vitest';
import { lastSeq, mergeMessages, newClientId, type ChatMessage } from './chat';

const msg = (seq: number, id = `id-${seq}`): ChatMessage => ({ id, seq, from: 'PATIENT', name: 'P', mine: true, body: `m${seq}`, sentAt: '2026-11-24T10:00:00Z' });

describe('mergeMessages', () => {
    it('adds new messages in seq order and skips ids already shown (overlapping reads)', () => {
        const shown = [msg(1), msg(3)];
        const merged = mergeMessages(shown, [msg(3), msg(2), msg(4)]);
        expect(merged.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    });

    it('keeps the same array when nothing is new, so React does not re-render', () => {
        const shown = [msg(1)];
        expect(mergeMessages(shown, [msg(1)])).toBe(shown);
        expect(mergeMessages(shown, [])).toBe(shown);
    });

    it('lastSeq is the cursor for the next read', () => {
        expect(lastSeq([])).toBe(0);
        expect(lastSeq([msg(5), msg(2)])).toBe(5);
    });

    it('client ids match the server rule', () => {
        expect(newClientId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });
});
