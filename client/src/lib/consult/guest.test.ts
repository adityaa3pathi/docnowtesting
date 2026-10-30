import { describe, expect, it } from 'vitest';
import { arrangeTiles, guestCopy, hasDoctor, partyOf, partyOfRole } from './guest';

describe('three-way call layout', () => {
    const doctor = { identity: 'doctor:d1' };
    const patient = { identity: 'patient:p1' };
    const caretaker = { identity: 'caretaker:u1' };

    it('reads who is who from the room identity', () => {
        expect(partyOf('doctor:d1')).toBe('doctor');
        expect(partyOf('caretaker:u1')).toBe('caretaker');
        expect(partyOf('3f2b8c1e-old-user-id')).toBeNull();
        expect(partyOfRole('patient-audio')).toBe('patient');
        expect(partyOfRole('caretaker')).toBe('caretaker');
        expect(partyOfRole('doctor-audio')).toBe('doctor');
    });

    it('puts the doctor big for the patient side, whatever order people joined in', () => {
        expect(arrangeTiles([caretaker, doctor], 'patient')).toEqual({ primary: doctor, others: [caretaker] });
        expect(arrangeTiles([patient, doctor], 'caretaker')).toEqual({ primary: doctor, others: [patient] });
    });

    it('puts the patient big for the doctor, the caregiver small', () => {
        expect(arrangeTiles([caretaker, patient], 'doctor')).toEqual({ primary: patient, others: [caretaker] });
    });

    it('falls back to the first person for old identities, and handles an empty room', () => {
        const old = { identity: 'user-123' };
        expect(arrangeTiles([old], 'patient').primary).toBe(old);
        expect(arrangeTiles([], 'patient')).toEqual({ primary: undefined, others: [] });
        expect(hasDoctor([caretaker])).toBe(false);
        expect(hasDoctor([caretaker, doctor])).toBe(true);
    });
});

describe('family room copy', () => {
    const info = { patientFirstName: 'Sunita', doctor: { name: 'Sharma', photoUrl: null, qualification: 'MBBS', specialty: 'GP' } };

    it('greets in Hindi first for a Hindi speaker, with English beneath', () => {
        const copy = guestCopy({ ...info, language: 'hi' });
        expect(copy.primary.greeting).toBe('नमस्ते Sunita जी, Dr. Sharma आपसे परामर्श के लिए तैयार हैं');
        expect(copy.secondary.greeting).toBe('Namaste Sunita ji, Dr. Sharma is ready for your consultation');
        expect(`${copy.primary.start} (${copy.secondary.start})`).toBe('डॉक्टर से बात करें (Start Call)');
    });

    it('swaps the order for an English speaker and keeps an existing "Dr" prefix', () => {
        const copy = guestCopy({ ...info, doctor: { ...info.doctor, name: 'Dr. Sharma' }, language: 'en' });
        expect(copy.primary.greeting).toBe('Namaste Sunita ji, Dr. Sharma is ready for your consultation');
        expect(copy.secondary.start).toBe('डॉक्टर से बात करें');
    });
});
