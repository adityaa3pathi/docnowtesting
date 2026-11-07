import { describe, expect, it } from 'vitest';
import { doctorTitle } from './doctors.types';

describe('doctorTitle', () => {
    it('adds "Dr." once, even when the saved name already has it', () => {
        expect(doctorTitle('Asha Sharma')).toBe('Dr. Asha Sharma');
        expect(doctorTitle('Dr. Asha Sharma')).toBe('Dr. Asha Sharma');
        expect(doctorTitle('dr asha')).toBe('dr asha');
        expect(doctorTitle('Drishti Rao')).toBe('Dr. Drishti Rao');
    });
});
