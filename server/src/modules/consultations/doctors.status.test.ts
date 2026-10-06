import { describe, expect, it } from 'vitest';
import { assertDoctorTransition, canTransitionDoctor, DoctorError } from './doctors.status';

describe('doctor status rules', () => {
    it('lets admin approve or reject a pending doctor', () => {
        expect(canTransitionDoctor('PENDING', 'APPROVED')).toBe(true);
        expect(canTransitionDoctor('PENDING', 'REJECTED')).toBe(true);
    });
    it('only suspends approved doctors and can reinstate them', () => {
        expect(canTransitionDoctor('APPROVED', 'SUSPENDED')).toBe(true);
        expect(canTransitionDoctor('SUSPENDED', 'APPROVED')).toBe(true);
        expect(canTransitionDoctor('PENDING', 'SUSPENDED')).toBe(false);
    });
    it('blocks no-op and backwards moves', () => {
        expect(canTransitionDoctor('APPROVED', 'APPROVED')).toBe(false);
        expect(canTransitionDoctor('APPROVED', 'PENDING')).toBe(false);
    });
    it('throws a 409 DoctorError', () => {
        try {
            assertDoctorTransition('REJECTED', 'SUSPENDED');
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(DoctorError);
            expect((e as DoctorError).status).toBe(409);
        }
    });
});
