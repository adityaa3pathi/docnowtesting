import { describe, expect, it } from 'vitest';
import { buildPrescription, builderFromPrescription, emptyMedicine, joinWindow, parseTestCodes, shouldWatchForPatient } from './room';
import type { Prescription } from './types';

const START = Date.parse('2026-10-13T05:00:00Z');
const call = (status = 'CONFIRMED' as const) => ({ status, startsAt: '2026-10-13T05:00:00Z', endsAt: '2026-10-13T05:15:00Z' });
const min = (n: number) => n * 60_000;

describe('join window', () => {
    it('opens 10 minutes before the start and says when', () => {
        expect(joinWindow(call(), START - min(11))).toEqual({ kind: 'early', opensAt: '2026-10-13T04:50:00.000Z' });
        expect(joinWindow(call(), START - min(10))).toEqual({ kind: 'open' });
    });
    it('stays open until 15 minutes after the end, then ends', () => {
        expect(joinWindow(call(), START + min(30))).toEqual({ kind: 'open' });
        expect(joinWindow(call(), START + min(31))).toEqual({ kind: 'ended' });
    });
    it('only lets confirmed, waiting or in-progress calls be joined', () => {
        expect(joinWindow({ ...call(), status: 'WAITING' }, START)).toEqual({ kind: 'open' });
        expect(joinWindow({ ...call(), status: 'IN_PROGRESS' }, START)).toEqual({ kind: 'open' });
        expect(joinWindow({ ...call(), status: 'COMPLETED' }, START)).toEqual({ kind: 'not_joinable' });
        expect(joinWindow({ ...call(), status: 'PENDING_PAYMENT' }, START)).toEqual({ kind: 'not_joinable' });
    });
});

describe('prescription builder', () => {
    it('reads test codes split by commas, spaces or lines, without repeats', () => {
        expect(parseTestCodes(' CBC, LFT\nCBC  TSH ,,')).toEqual(['CBC', 'LFT', 'TSH']);
        expect(parseTestCodes('   ')).toEqual([]);
    });
    it('drops blank medicine rows and trims the rest', () => {
        const r = buildPrescription([emptyMedicine(), { ...emptyMedicine(), name: ' Paracetamol ', dose: '500 mg ' }], '', '');
        expect(r).toEqual({ ok: true, body: { medicines: [{ ...emptyMedicine(), name: 'Paracetamol', dose: '500 mg' }], testCodes: [] } });
    });
    it('rejects a medicine row with details but no name', () => {
        expect(buildPrescription([{ ...emptyMedicine(), dose: '1 tab' }], '', '')).toEqual({ ok: false, error: 'Each medicine needs a name.' });
    });
    it('needs at least one medicine, test or advice', () => {
        expect(buildPrescription([emptyMedicine()], ' ', '  ').ok).toBe(false);
        expect(buildPrescription([], 'CBC', '')).toEqual({ ok: true, body: { medicines: [], testCodes: ['CBC'] } });
        expect(buildPrescription([], '', ' Rest well ')).toEqual({ ok: true, body: { medicines: [], testCodes: [], advice: 'Rest well' } });
    });
    it('caps tests at 10 like the server', () => {
        const codes = Array.from({ length: 11 }, (_, i) => `T${i}`).join(',');
        expect(buildPrescription([], codes, '')).toEqual({ ok: false, error: 'Add at most 10 tests.' });
    });
});

describe('watching for the patient', () => {
    it('re-checks only before the call while the patient may still join', () => {
        expect(shouldWatchForPatient('CONFIRMED', false)).toBe(true);
        expect(shouldWatchForPatient('WAITING', false)).toBe(true);
        expect(shouldWatchForPatient('WAITING', true)).toBe(false);
        expect(shouldWatchForPatient('IN_PROGRESS', false)).toBe(false);
        expect(shouldWatchForPatient('NO_SHOW_PATIENT', false)).toBe(false);
    });
});

describe('correcting a prescription', () => {
    const issued = {
        id: 'p1', consultationId: 'c1', version: 1, issuedAt: '2026-10-13T05:20:00Z',
        medicines: [{ name: 'Paracetamol', dose: '500 mg', frequency: 'Twice a day', duration: '3 days', instructions: '' }],
        recommendedTests: [{ code: 'CBC', name: 'Complete blood count' }, { code: 'TSH', name: 'Thyroid' }],
        advice: 'Drink water',
    } as Prescription;

    it('pre-fills medicines, test codes and advice from the current version', () => {
        // Old prescriptions have only the free-text fields; the new ones start empty.
        expect(builderFromPrescription(issued)).toEqual({ rows: issued.medicines.map((m) => ({ ...emptyMedicine(), ...m })), codes: 'CBC, TSH', advice: 'Drink water' });
    });
    it('round-trips through the builder check unchanged', () => {
        const b = builderFromPrescription(issued);
        expect(buildPrescription(b.rows, b.codes, b.advice)).toEqual({
            ok: true, body: { medicines: issued.medicines.map((m) => ({ ...emptyMedicine(), ...m })), testCodes: ['CBC', 'TSH'], advice: 'Drink water' },
        });
    });
    it('starts with one blank row when there were no medicines', () => {
        expect(builderFromPrescription({ ...issued, medicines: [], advice: null })).toEqual({ rows: [emptyMedicine()], codes: 'CBC, TSH', advice: '' });
    });
});

describe('buildPrescription with structured fields', () => {
    it('keeps strength, times, food and days, trimmed', () => {
        const row = { ...emptyMedicine(), name: ' Cetirizine ', strength: ' 10 mg ', doseTimes: ['NIGHT' as const], foodTiming: 'AFTER_FOOD' as const, durationDays: 5 };
        const r = buildPrescription([row], '', '');
        expect(r).toEqual({ ok: true, body: { medicines: [{ ...row, name: 'Cetirizine', strength: '10 mg' }], testCodes: [] } });
    });
    it('a row with only a time or days still needs a name', () => {
        expect(buildPrescription([{ ...emptyMedicine(), doseTimes: ['MORNING'] }], '', '')).toEqual({ ok: false, error: 'Each medicine needs a name.' });
        expect(buildPrescription([{ ...emptyMedicine(), durationDays: 3 }], '', '').ok).toBe(false);
    });
    it('rejects days outside 1 to 365 or not whole', () => {
        for (const durationDays of [0, 366, 2.5]) {
            const r = buildPrescription([{ ...emptyMedicine(), name: 'X', durationDays }], '', '');
            expect(r).toEqual({ ok: false, error: 'X: the duration must be 1 to 365 days.' });
        }
    });
    it('a correction of an old prescription starts with its free-text fields', () => {
        const old = { name: 'Azithromycin', dose: '500 mg', frequency: 'Once a day', duration: '3 days', instructions: '' };
        const b = builderFromPrescription({ id: 'p1', consultationId: 'c1', version: 1, issuedAt: '', medicines: [old], recommendedTests: [], advice: null } as unknown as Prescription);
        expect(b.rows[0]).toEqual({ ...emptyMedicine(), ...old });
    });
});

