import { describe, expect, it } from 'vitest';
import { cleanReason, docsOnline, elapsed, endedCopy, feeRange, instantScreen, queueLine, secondsLeft } from './instant';

describe('instant consult rules', () => {
    it('maps the request status to a screen', () => {
        expect(instantScreen('SEARCHING')).toBe('searching');
        expect(instantScreen('ACCEPTED')).toBe('pay');
        expect(instantScreen('BOOKED')).toBe('booked');
        for (const s of ['CANCELLED', 'NO_MATCH', 'UNPAID'] as const) expect(instantScreen(s)).toBe('ended');
    });

    it('counts up from the start and down to a deadline, never below zero', () => {
        const start = '2026-11-24T10:00:00.000Z';
        expect(elapsed(start, Date.parse(start) + 84_000)).toBe('1:24');
        expect(elapsed(start, Date.parse(start) - 5_000)).toBe('0:00');
        expect(secondsLeft('2026-11-24T10:03:00.000Z', Date.parse(start) + 179_100)).toBe(1);
        expect(secondsLeft('2026-11-24T10:03:00.000Z', Date.parse(start) + 200_000)).toBe(0);
        expect(secondsLeft(null, 0)).toBe(0);
        expect(secondsLeft('2026-11-24T10:01:02.000Z', Date.parse(start), 60)).toBe(60);
    });

    it('shows one fee or a range', () => {
        expect(feeRange({ feeMinPaise: 35000, feeMaxPaise: 35000 })).toBe('₹350');
        expect(feeRange({ feeMinPaise: 30000, feeMaxPaise: 45000 })).toBe('₹300 to ₹450');
        expect(feeRange({ feeMinPaise: null, feeMaxPaise: null })).toBeNull();
        expect(docsOnline(1)).toBe('1 Doc online now');
        expect(docsOnline(3)).toBe('3 Docs online now');
    });

    it('says where the patient is in line only when every Doc is busy', () => {
        expect(queueLine({ position: 1, doctorsOnline: 2, doctorsFree: 1 })).toBe('Asking an available Doc now.');
        expect(queueLine({ position: 2, doctorsOnline: 2, doctorsFree: 0 })).toBe("All Docs are on calls. You're 2nd in line. We'll connect you to the next Doc who's free.");
        expect(queueLine({ position: 1, doctorsOnline: 1, doctorsFree: 0 })).toContain("You're 1st in line");
        expect(queueLine({ position: 1, doctorsOnline: 0, doctorsFree: 0 })).toContain('No Doc is online');
        // Our own ring holds the only free Doc: still "asking", not "all on calls".
        expect(queueLine({ position: 1, doctorsOnline: 1, doctorsFree: 0, asking: true })).toBe('Asking an available Doc now.');
    });

    it('always says nothing was charged when a request ends', () => {
        for (const s of ['CANCELLED', 'NO_MATCH', 'UNPAID'] as const) expect(endedCopy(s).body).toContain('Nothing was charged');
    });

    it('tidies the reason the way the server does', () => {
        expect(cleanReason('  fever \n since   yesterday ')).toBe('fever since yesterday');
    });
});

describe('doctor panel copy', async () => {
    const { offlineReasonText, ringShareLeft, patientLine, onlineFor } = await import('./instant');
    it('explains an automatic offline, and says nothing for a manual one', () => {
        expect(offlineReasonText('MISSED_RINGS')).toContain('missed 2 requests');
        expect(offlineReasonText('TIMEOUT')).toContain('lost its connection');
        expect(offlineReasonText('OFF')).toBeNull();
        expect(offlineReasonText(null)).toBeNull();
    });
    it('draws the ring bar from the server time, clamped', () => {
        const end = '2026-11-24T10:01:00.000Z';
        expect(ringShareLeft(end, Date.parse(end) - 30_000)).toBe(0.5);
        expect(ringShareLeft(end, Date.parse(end) + 1)).toBe(0);
        expect(ringShareLeft(end, Date.parse(end) - 90_000)).toBe(1);
    });
    it('describes the patient without a name', () => {
        expect(patientLine(34, 'F')).toBe('Female, 34');
        expect(patientLine(61, 'Male')).toBe('Male, 61');
    });
    it('shows how long the doctor has been online', () => {
        const since = '2026-11-24T10:00:00.000Z';
        expect(onlineFor(since, Date.parse(since) + 12 * 60_000)).toBe('12 min');
        expect(onlineFor(since, Date.parse(since) + 65 * 60_000)).toBe('1 h 5 min');
    });
});
