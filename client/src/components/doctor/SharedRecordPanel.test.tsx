// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedRecord } from '@/lib/consult/types';

const m = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get, put: m.put }, getApiUrl: (p: string) => `/api${p}` }));
const { SharedRecordPanel } = await import('./SharedRecordPanel');
const { RecordSharingCard } = await import('../consult/RecordSharingCard');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const shared: SharedRecord = {
    shared: true,
    until: '2026-12-01T10:15:00.000Z',
    reports: [{ id: 'r1', label: 'CBC, Lipid profile', isFullReport: true, date: '2026-10-01T08:00:00.000Z' }],
    consultations: [{
        id: 'p1', startsAt: '2026-10-05T10:00:00.000Z', type: 'VIDEO', doctorName: 'Dr Kapoor', specialty: 'General Physician',
        note: { complaints: 'Cough', findings: null, diagnosis: 'Bronchitis', advice: 'Steam', followUpDays: 7 },
        prescription: null,
        attachments: [{ id: 'a1', name: 'xray.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, uploadedAt: '2026-10-04T10:00:00.000Z' }],
    }],
    documents: [{ id: 'd1', name: 'discharge.pdf', mimeType: 'application/pdf', sizeBytes: 300_000, uploadedAt: '2026-09-01T10:00:00.000Z' }],
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const buttons = () => Array.from(document.body.querySelectorAll('button'));
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ''))!;
let root: ReturnType<typeof createRoot>;
async function mount(node: React.ReactNode) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(node));
    await flush();
}
/** The doctor's panel loads nothing until "Open health record" is pressed. */
async function openPanel() {
    await mount(<SharedRecordPanel consultationId="c1" />);
    await act(async () => byText(/Open health record/).click());
    await flush();
}

beforeEach(() => {
    m.get.mockReset();
    m.put.mockReset();
});
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('SharedRecordPanel', () => {
    it('loads nothing (so logs nothing) until the doctor opens it', async () => {
        await mount(<SharedRecordPanel consultationId="c1" />);
        expect(m.get).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('The patient can see when you opened it');
    });

    it('says why the record is closed when the patient did not share it', async () => {
        m.get.mockResolvedValue({ data: { shared: false, reason: 'NOT_SHARED', until: shared.until } });
        await openPanel();
        expect(m.get).toHaveBeenCalledWith('/doctor/me/consultations/c1/record');
        expect(document.body.textContent).toContain('has not shared their full DocNow health record');
        expect(document.body.querySelector('[role="tablist"]')).toBeNull();
    });

    it('says when access ended', async () => {
        m.get.mockResolvedValue({ data: { shared: false, reason: 'ENDED', until: '2026-11-01T10:15:00.000Z' } });
        await openPanel();
        expect(document.body.textContent).toMatch(/Access to this health record ended on Sun, 1 Nov\./);
    });

    it('lists reports, past visits with other doctors\' notes, and files, with counts per tab', async () => {
        m.get.mockResolvedValue({ data: shared });
        await openPanel();
        const text = () => document.body.textContent ?? '';
        expect(text()).toContain('Lab reports(1)');
        expect(text()).toContain('CBC, Lipid profile');
        expect(text()).toContain('Each file you open is recorded');
        await act(async () => byText(/Past visits/).click());
        expect(text()).toContain('Dr Kapoor');
        expect(text()).toContain('Diagnosis: Bronchitis');
        expect(text()).toContain('Follow-up advised in 7 days');
        await act(async () => byText(/^Files/).click());
        expect(text()).toContain('discharge.pdf');
    });

    it('opens a file only on click, through the logged route, and previews it', async () => {
        m.get.mockResolvedValueOnce({ data: shared });
        await openPanel();
        await act(async () => byText(/^Files/).click());
        expect(m.get).toHaveBeenCalledTimes(1);
        m.get.mockResolvedValueOnce({ data: { kind: 'document', name: 'discharge.pdf', mimeType: 'application/pdf', url: 'https://s3.test/d1.pdf?sig' } });
        await act(async () => byText(/discharge\.pdf/).click());
        await flush();
        expect(m.get).toHaveBeenLastCalledWith('/doctor/me/consultations/c1/record/documents/d1');
        const frame = document.body.querySelector('[data-testid="record-preview"]') as HTMLIFrameElement;
        expect(frame.tagName).toBe('IFRAME');
        expect(frame.getAttribute('src')).toBe('https://s3.test/d1.pdf?sig');
    });

    it('opens a lab report in a tab made during the click (pop-up blockers), with the short token', async () => {
        m.get.mockResolvedValueOnce({ data: shared });
        await openPanel();
        const win = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
        const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
        m.get.mockResolvedValueOnce({ data: { kind: 'report', viewToken: 'tok123' } });
        await act(async () => byText(/CBC, Lipid profile/).click());
        await flush();
        expect(open).toHaveBeenCalledWith('', '_blank');
        expect(m.get).toHaveBeenLastCalledWith('/doctor/me/consultations/c1/record/reports/r1');
        expect(win.location.href).toBe('/api/reports/public/tok123');
        expect(win.opener).toBeNull();
    });

    it('closes the empty tab and shows the reason when opening fails', async () => {
        m.get.mockResolvedValueOnce({ data: shared });
        await openPanel();
        const win = { opener: null, location: { href: '' }, close: vi.fn() };
        vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
        m.get.mockRejectedValueOnce({ response: { data: { error: 'Access to this health record has ended' } } });
        await act(async () => byText(/CBC, Lipid profile/).click());
        await flush();
        expect(win.close).toHaveBeenCalled();
        expect(document.body.textContent).toContain('ended');
    });
});

describe('SharedRecordPanel vitals (P8)', () => {
    beforeAll(() => {
        // jsdom has no ResizeObserver; the trend chart's container needs one.
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    });
    const bp = (id: string, systolic: number, diastolic: number, at: string) => ({ id, kind: 'BP' as const, systolic, diastolic, pulse: 70, glucoseMgDl: null, sugarTiming: null, measuredAt: at, note: null });
    const withVitals: SharedRecord = {
        ...(shared as Extract<SharedRecord, { shared: true }>),
        vitals: {
            since: '2026-05-28T00:00:00.000Z',
            bp: [bp('b2', 138, 88, '2026-11-20T03:00:00.000Z'), bp('b1', 130, 84, '2026-11-10T03:00:00.000Z')],
            sugar: [{ id: 's1', kind: 'SUGAR', systolic: null, diastolic: null, pulse: null, glucoseMgDl: 126, sugarTiming: 'FASTING', measuredAt: '2026-11-19T02:00:00.000Z', note: 'before breakfast' }],
            periods: [{ id: 'p1', startDate: '2026-11-02', endDate: '2026-11-06', flow: 'MEDIUM', symptoms: ['CRAMPS'] }],
            periodEstimate: { nextStart: '2026-11-30', averageCycleDays: 28, cyclesUsed: 3, passed: false },
        },
    };

    it('shows a Vitals tab with the latest readings, the trend and the periods, numbers only', async () => {
        m.get.mockResolvedValue({ data: withVitals, headers: {} });
        await openPanel();
        const tab = byText(/Vitals/);
        expect(tab.textContent).toContain('(4)');
        await act(async () => tab.click());
        const text = document.body.textContent ?? '';
        expect(text).toContain('Latest 138/88 mmHg');
        expect(text).toContain('Latest 126 mg/dL');
        expect(text).toContain('Fasting · before breakfast');
        expect(text).toContain('Typed in by the patient');
        expect(text).toContain("Patient's estimated next start: 30 Nov 2026");
        expect(text).toContain('Medium · Cramps');
        expect(document.body.querySelector('[role="img"][aria-label^="Blood pressure trend, 2 readings"]')).not.toBeNull();
        // No judging words next to the numbers.
        expect(text).not.toMatch(/\b(high|low|normal|abnormal|elevated|diabetic|diabetes|hypertension)\b/i);
    });

    it('says when the list is cut ("latest N of M"), and that readings start on an IST day', async () => {
        const v = (withVitals as { vitals: NonNullable<Extract<SharedRecord, { shared: true }>['vitals']> }).vitals;
        m.get.mockResolvedValue({ data: { ...withVitals, vitals: { ...v, since: '2026-05-28', totals: { bp: 75, sugar: 1, periods: 1 } } }, headers: {} });
        await openPanel();
        await act(async () => byText(/Vitals/).click());
        const text = document.body.textContent ?? '';
        expect(text).toContain('Showing the latest 2 of 75 readings in this period');
        expect(text).toContain('Readings since 28 May 2026');
        expect(text.match(/Showing the latest/g)).toHaveLength(1);
    });

    it('a consent from before vitals: no Vitals tab, and a line saying why', async () => {
        m.get.mockResolvedValue({ data: { ...withVitals, vitals: null }, headers: {} });
        await openPanel();
        expect(buttons().some((b) => /Vitals/.test(b.textContent ?? ''))).toBe(false);
        expect(document.body.textContent).toContain('Vitals are not included: the patient agreed to sharing before vitals were part of it.');
    });

    it('has no Vitals tab when an older server leaves vitals out', async () => {
        m.get.mockResolvedValue({ data: shared, headers: {} });
        await openPanel();
        expect(buttons().some((b) => /Vitals/.test(b.textContent ?? ''))).toBe(false);
    });
});

describe('RecordSharingCard', () => {
    const base = { shared: true, sharedAt: '2026-11-20T10:00:00.000Z', until: '2026-12-01T10:15:00.000Z', canShare: true, lastViewedAt: '2026-11-23T05:00:00.000Z', version: 'record-share-v1' };

    it('shows who can see what until when, and stops sharing at once', async () => {
        m.put.mockResolvedValue({ data: { ...base, shared: false } });
        await mount(<RecordSharingCard bookingId="c1" doctorName="Dr Meera" patientName="Sunita" sharing={base} />);
        expect(document.body.textContent).toContain("Dr Meera can see Sunita's DocNow lab reports");
        expect(document.body.textContent).toContain('Last opened by the doctor');
        await act(async () => byText(/Stop sharing/).click());
        await flush();
        expect(m.put).toHaveBeenCalledWith('/consult/bookings/c1/record-sharing', { share: false, consentVersion: 'record-share-v2', channel: 'web' });
        expect(document.body.textContent).toContain('Dr Meera sees only the details on this booking');
    });

    it('shows the consent wording before switching on', async () => {
        m.put.mockResolvedValue({ data: base });
        await mount(<RecordSharingCard bookingId="c1" doctorName="Dr Meera" patientName="Sunita" sharing={{ ...base, shared: false, lastViewedAt: null }} />);
        expect(document.body.textContent).toContain("Let Dr Meera see Sunita's DocNow health record");
        await act(async () => byText(/I agree, share it/).click());
        await flush();
        expect(m.put).toHaveBeenCalledWith('/consult/bookings/c1/record-sharing', { share: true, consentVersion: 'record-share-v2', channel: 'web' });
    });

    it('is hidden when the booking can no longer be shared and is not shared', async () => {
        await mount(<RecordSharingCard bookingId="c1" doctorName="Dr Meera" patientName="Sunita" sharing={{ ...base, shared: false, canShare: false }} />);
        expect(document.body.textContent).toBe('');
    });
});
