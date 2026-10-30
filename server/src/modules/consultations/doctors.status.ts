/**
 * Doctor approval status rules. Call assertDoctorTransition() before every status change.
 */
import type { DoctorStatus } from '@prisma/client';

const VALID: Record<DoctorStatus, DoctorStatus[]> = {
    PENDING: ['APPROVED', 'REJECTED'],
    APPROVED: ['SUSPENDED'],
    SUSPENDED: ['APPROVED'],
    REJECTED: ['APPROVED'],
};

export function canTransitionDoctor(from: DoctorStatus, to: DoctorStatus): boolean {
    return VALID[from]?.includes(to) ?? false;
}

export function assertDoctorTransition(from: DoctorStatus, to: DoctorStatus): void {
    if (!canTransitionDoctor(from, to)) {
        throw new DoctorError(409, `Cannot change doctor status from ${from} to ${to}`);
    }
}

export class DoctorError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
