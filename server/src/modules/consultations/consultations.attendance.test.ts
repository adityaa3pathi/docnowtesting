import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({ prisma: {} }));
const { attendanceRange, classify, csvCell, LATE_AFTER_MINUTES } = await import('./consultations.attendance');

const start = new Date('2026-11-20T05:30:00Z'); // 11:00 IST
const at = (minutes: number, seconds = 0) => new Date(start.getTime() + minutes * 60_000 + seconds * 1000);
const base = { status: 'COMPLETED', startsAt: start, doctorJoinedAt: at(0), patientJoinedAt: at(0), doctorNoShowRefund: false };

describe('classify: late means joining more than 5 minutes after the start', () => {
    it('uses the same 5 minutes the app uses to tell a patient their doctor is late', () => {
        expect(LATE_AFTER_MINUTES).toBe(5);
    });

    it('counts a join at exactly 5 minutes, or before the start, as on time', () => {
        expect(classify({ ...base, doctorJoinedAt: at(5), patientJoinedAt: at(-8) })).toEqual({
            doctor: { outcome: 'ON_TIME', joinedAt: at(5), minutesLate: null },
            patient: { outcome: 'ON_TIME', joinedAt: at(-8), minutesLate: null },
        });
    });

    it('counts a join after 5 minutes as late, in whole minutes', () => {
        const r = classify({ ...base, doctorJoinedAt: at(5, 1), patientJoinedAt: at(12, 40) });
        expect(r.doctor).toMatchObject({ outcome: 'LATE', minutesLate: 5 });
        expect(r.patient).toMatchObject({ outcome: 'LATE', minutesLate: 12 });
    });

    it('marks doctor no-shows by status, or by the no-show refund once the status moved on', () => {
        expect(classify({ ...base, status: 'NO_SHOW_DOCTOR', doctorJoinedAt: null }).doctor.outcome).toBe('NO_SHOW');
        expect(classify({ ...base, status: 'REFUNDED', doctorJoinedAt: null, doctorNoShowRefund: true }).doctor.outcome).toBe('NO_SHOW');
    });

    it('marks patient no-shows, and does not call a patient late or absent when the doctor never came', () => {
        expect(classify({ ...base, status: 'NO_SHOW_PATIENT', patientJoinedAt: null }).patient.outcome).toBe('NO_SHOW');
        expect(classify({ ...base, status: 'NO_SHOW_DOCTOR', doctorJoinedAt: null, patientJoinedAt: null }).patient.outcome).toBe('NOT_JOINED');
    });
});

describe('attendanceRange: IST days', () => {
    it('defaults to the last 30 IST days, today included, even just after IST midnight', () => {
        const now = new Date('2026-11-22T19:00:00Z'); // 00:30 IST on 23 Nov
        const r = attendanceRange({}, now);
        expect(r).toMatchObject({ from: '2026-10-25', to: '2026-11-23' });
        expect(r.start.toISOString()).toBe('2026-10-24T18:30:00.000Z');
        expect(r.end.toISOString()).toBe('2026-11-23T18:30:00.000Z');
    });

    it('takes one day, and refuses a start after the end or a range over 366 days', () => {
        expect(attendanceRange({ from: '2026-11-01', to: '2026-11-01' }).end.getTime() - attendanceRange({ from: '2026-11-01', to: '2026-11-01' }).start.getTime()).toBe(24 * 3_600_000);
        expect(() => attendanceRange({ from: '2026-11-02', to: '2026-11-01' })).toThrow('The start date must be on or before the end date');
        expect(() => attendanceRange({ from: '2025-01-01', to: '2026-01-01' })).not.toThrow();
        expect(() => attendanceRange({ from: '2025-01-01', to: '2026-01-02' })).toThrow('Pick a range of at most 366 days');
    });
});

describe('csvCell', () => {
    it('quotes every cell and stops spreadsheet formulas in patient-typed names', () => {
        expect(csvCell('Asha "Rani" Devi')).toBe('"Asha ""Rani"" Devi"');
        expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
        expect(csvCell('+91')).toBe('"\'+91"');
        expect(csvCell(12)).toBe('"12"');
        expect(csvCell(null)).toBe('""');
    });
});
