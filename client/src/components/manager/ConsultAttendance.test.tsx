// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceReport } from '@/lib/consult/types';

const m = vi.hoisted(() => ({ attendance: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/consult/api', () => ({
    manager: { attendance: m.attendance, downloadAttendanceCsv: m.download },
    errorMessage: (e: { response?: { data?: { error?: string } } }, fallback = 'Something went wrong') => e?.response?.data?.error ?? fallback,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { ConsultAttendance } = await import('./ConsultAttendance');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const text = () => document.body.textContent ?? '';
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

const side = (outcome: string, minutesLate: number | null = null) => ({ outcome, joinedAt: null, minutesLate });
const report = (over: Partial<AttendanceReport> = {}): AttendanceReport => ({
    from: '2026-10-25', to: '2026-11-23', lateAfterMinutes: 5, truncated: false,
    totals: {
        consultations: 5,
        doctor: { consultations: 5, noShows: 2, late: 1, avgMinutesLate: 8 },
        patient: { consultations: 5, noShows: 1, late: 1, avgMinutesLate: 12 },
    },
    doctors: [
        { doctorId: 'd2', name: 'Dr Bharat', consultations: 2, noShows: 2, late: 0, avgMinutesLate: null },
        { doctorId: 'd1', name: 'Dr Asha', consultations: 3, noShows: 0, late: 1, avgMinutesLate: 8 },
    ],
    patients: [
        { patientId: 'p2', name: 'Ravi', mobile: '9876543210', consultations: 2, noShows: 1, late: 0, avgMinutesLate: null },
        { patientId: 'p3', name: 'Gone', mobile: null, consultations: 1, noShows: 1, late: 0, avgMinutesLate: null },
    ],
    issues: [
        { consultationId: 'c1', startsAt: '2026-11-20T05:30:00Z', status: 'COMPLETED', doctorId: 'd1', doctorName: 'Dr Asha', patientId: 'p1', patientName: 'Priya', mobile: '9876500000', doctor: side('LATE', 8), patient: side('LATE', 12) },
        { consultationId: 'c2', startsAt: '2026-11-21T05:30:00Z', status: 'NO_SHOW_DOCTOR', doctorId: 'd2', doctorName: 'Dr Bharat', patientId: 'p2', patientName: 'Ravi', mobile: '9876543210', doctor: side('NO_SHOW'), patient: side('ON_TIME') },
    ],
    ...over,
}) as AttendanceReport;

let root: ReturnType<typeof createRoot>;
async function render() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<ConsultAttendance />));
    await flush();
}
async function setDate(id: string, value: string) {
    const input = document.getElementById(id) as HTMLInputElement;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
}

beforeEach(() => {
    m.attendance.mockReset();
    m.download.mockReset();
});
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
});

describe('Consult no-shows report (manager portal)', () => {
    it('asks for the last 30 IST days and shows totals, per-doctor and per-patient counts and the problem list', async () => {
        m.attendance.mockResolvedValue(report());
        await render();

        const { from, to } = m.attendance.mock.calls[0][0];
        expect(Date.parse(to) - Date.parse(from)).toBe(29 * 24 * 3_600_000);
        expect(text()).toContain('Late means joining more than 5 minutes after the start');
        expect(text()).toContain('Doctor no-shows2');
        expect(text()).toContain('8 min late on average');
        expect(text()).toContain('Dr Bharat');
        expect(text()).toContain('Deleted account');
        expect(text()).toContain('Late (8 min)');
        expect(text()).toContain('Late (12 min)');
        expect(text()).toContain('No-show');
        expect(text()).toContain('On time');
    });

    it('reloads for new dates, and does not ask the server for a start after the end', async () => {
        m.attendance.mockResolvedValue(report());
        await render();
        await setDate('from', '2026-11-01');
        expect(m.attendance).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-01' }));

        const calls = m.attendance.mock.calls.length;
        await setDate('from', '2099-01-01');
        expect(m.attendance).toHaveBeenCalledTimes(calls);
        expect(text()).toContain('Pick a start date on or before the end date.');
        expect(button('Export CSV')!.disabled).toBe(true);
    });

    it('downloads the CSV for the chosen dates', async () => {
        m.attendance.mockResolvedValue(report());
        m.download.mockResolvedValue(undefined);
        await render();
        await act(async () => { button('Export CSV')!.click(); });
        expect(m.download).toHaveBeenCalledWith(m.attendance.mock.calls[0][0]);
    });

    it('says when there is nothing in the range, and warns when counts are partial', async () => {
        m.attendance.mockResolvedValue(report({ totals: { consultations: 0, doctor: { consultations: 0, noShows: 0, late: 0, avgMinutesLate: null }, patient: { consultations: 0, noShows: 0, late: 0, avgMinutesLate: null } }, doctors: [], patients: [], issues: [] }));
        await render();
        expect(text()).toContain('No consultations in these dates');

        act(() => root.unmount());
        document.body.innerHTML = '';
        m.attendance.mockResolvedValue(report({ truncated: true }));
        await render();
        expect(text()).toContain('The numbers below are partial. Pick a shorter range.');
    });

    it('shows the server error', async () => {
        m.attendance.mockRejectedValue({ response: { data: { error: 'Pick a range of at most 366 days' } } });
        await render();
        expect(text()).toContain('Pick a range of at most 366 days');
    });
});
