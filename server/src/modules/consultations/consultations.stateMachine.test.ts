import { describe, expect, it } from 'vitest';
import { ConsultationStatus as S } from './consultations.types';
import { assertTransition, canTransition } from './consultations.stateMachine';

describe('consultation state machine', () => {
    it('allows the happy path', () => {
        const path = [S.PENDING_PAYMENT, S.CONFIRMED, S.WAITING, S.IN_PROGRESS, S.COMPLETED];
        for (let i = 0; i < path.length - 1; i++) {
            expect(canTransition(path[i], path[i + 1])).toBe(true);
        }
    });

    it('allows reschedule and returns to confirmed', () => {
        expect(canTransition(S.CONFIRMED, S.RESCHEDULED)).toBe(true);
        expect(canTransition(S.RESCHEDULED, S.CONFIRMED)).toBe(true);
    });

    it('allows refunds after cancel and both no-shows', () => {
        for (const from of [S.CANCELLED, S.NO_SHOW_PATIENT, S.NO_SHOW_DOCTOR]) {
            expect(canTransition(from, S.REFUNDED)).toBe(true);
        }
    });

    it('treats completed and refunded as terminal', () => {
        for (const to of Object.values(S)) {
            expect(canTransition(S.COMPLETED, to)).toBe(false);
            expect(canTransition(S.REFUNDED, to)).toBe(false);
        }
    });

    it('blocks skipping payment or the call', () => {
        expect(canTransition(S.PENDING_PAYMENT, S.IN_PROGRESS)).toBe(false);
        expect(canTransition(S.CONFIRMED, S.COMPLETED)).toBe(false);
        expect(canTransition(S.IN_PROGRESS, S.CANCELLED)).toBe(false);
    });

    it('throws on an invalid transition', () => {
        expect(() => assertTransition(S.COMPLETED, S.WAITING)).toThrow(
            'Invalid consultation state transition: COMPLETED → WAITING'
        );
        expect(() => assertTransition(S.CONFIRMED, S.WAITING)).not.toThrow();
    });
});
