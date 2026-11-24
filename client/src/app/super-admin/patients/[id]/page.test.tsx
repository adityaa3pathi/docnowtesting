// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminPatientRecord } from '@/lib/consult/types';

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get }, getApiUrl: (p: string) => `/api${p}` }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'p1' }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const { default: Page } = await import('./page');

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

const record: AdminPatientRecord = {
    totals: { consultations: 130, reports: 1, consents: 1, accessLog: 1 },
    listLimit: 100,
    person: { id: 'p1', name: 'Sunita Devi', relation: 'Mother', age: 62, gender: 'Female', dob: null, bloodGroup: 'B+', allergies: ['Sulfa'], allergiesConfirmedAt: '2026-11-01T00:00:00.000Z', chronicConditions: [], currentMedications: [] },
    account: { id: 'u1', name: 'Ravi', mobile: '9000000003', status: 'ACTIVE', deleted: false },
    consultations: [{
        id: 'c1', startsAt: '2026-11-10T04:30:00.000Z', status: 'COMPLETED', type: 'VIDEO', feePaise: 50000, walletPaise: 10000, discountPaise: 0,
        cancelReason: null, cancelledBy: null, endedAt: null, recordSharedAt: '2026-11-09T00:00:00.000Z', createdAt: '2026-11-09T00:00:00.000Z', promoCode: null,
        doctor: { id: 'd1', displayName: 'Meera Rao', specialty: { name: 'General Physician' } },
        note: { complaints: 'Dizzy', findings: null, diagnosis: 'Low BP', advice: null, followUpDays: null },
        prescription: null, voidedPrescriptions: [],
        attachments: [{ id: 'a1', name: 'ecg.jpg', mimeType: 'image/jpeg', sizeBytes: 9, uploadedAt: '2026-11-09T00:00:00.000Z' }],
        payments: [{ id: 'pay1', source: 'WALLET', amountPaise: 10000, status: 'CAPTURED', razorpayPaymentId: null, capturedAt: null }], refunds: [],
    }],
    reports: [{ id: 'r1', bookingId: 'b1', label: 'TSH', isFullReport: true, fetchStatus: 'STORED', date: '2026-11-01T00:00:00.000Z' }],
    documents: [],
    consents: [{ id: 's1', consultationId: 'c1', granted: true, version: 'record-share-v1', channel: 'web', userId: 'u1', createdAt: '2026-11-09T00:00:00.000Z' }],
    accessLog: [{ id: 'l1', at: '2026-11-10T04:31:00.000Z', action: 'RECORD', targetId: null, consultationId: 'c1', doctorName: 'Meera Rao' }],
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
let root: ReturnType<typeof createRoot>;
beforeEach(() => m.get.mockReset());
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('super admin patient record page', () => {
    it('shows the record, says it is logged, and opens a report through the logged route in a new tab', async () => {
        m.get.mockResolvedValueOnce({ data: record });
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<Page />));
        await flush();
        const text = document.body.textContent ?? '';
        expect(m.get).toHaveBeenCalledWith('/admin/consult/patients/p1/record');
        expect(text).toContain('recorded in the audit log');
        expect(text).toContain('Sulfa');
        expect(text).toContain('Low BP');
        expect(text).toContain('Meera Rao · Opened the record');
        expect(text).toContain('Shared · web');
        expect(text).toContain('Consultations (1) (latest 1 of 130)');

        const win = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
        vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
        m.get.mockResolvedValueOnce({ data: { kind: 'report', viewToken: 'tok' } });
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('TSH'))!;
        await act(async () => btn.click());
        await flush();
        expect(m.get).toHaveBeenLastCalledWith('/admin/consult/patients/p1/record/reports/r1');
        expect(win.location.href).toBe('/api/reports/public/tok');
        expect(win.opener).toBeNull();
    });
});
