import { describe, expect, it } from 'vitest';
import { doctorStatusInfo, statusInfo, VERIFY_MESSAGES } from './status';
import type { ConsultationStatus, DoctorStatus, VerifyOutcome } from './types';

const ALL_STATUSES: ConsultationStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR', 'EXPIRED', 'REFUNDED'];
const ALL_OUTCOMES: VerifyOutcome[] = ['confirmed', 'reclaimed', 'already', 'refund_created', 'flagged', 'unknown_order'];

describe('status text', () => {
    it('has a label for every consultation and doctor status', () => {
        for (const s of ALL_STATUSES) expect(statusInfo(s).label.length).toBeGreaterThan(0);
        for (const s of ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as DoctorStatus[]) expect(doctorStatusInfo(s).label.length).toBeGreaterThan(0);
    });
    it('allows cancelling only where the server does', () => {
        const cancellable = ALL_STATUSES.filter((s) => statusInfo(s).canCancel).sort();
        expect(cancellable).toEqual(['CONFIRMED', 'PENDING_PAYMENT', 'RESCHEDULED', 'WAITING']);
    });
    it('has its own message for every verify outcome, and none says the payment failed', () => {
        for (const o of ALL_OUTCOMES) {
            const m = VERIFY_MESSAGES[o];
            expect(m.title.length).toBeGreaterThan(0);
            expect(`${m.title} ${m.body}`.toLowerCase()).not.toContain('failed');
        }
        expect(new Set(ALL_OUTCOMES.map((o) => VERIFY_MESSAGES[o].title)).size).toBeGreaterThanOrEqual(4);
    });
});
