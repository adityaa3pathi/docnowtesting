// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ConsultAttachment, DoctorConsultationRecord } from '@/lib/consult/types';
import { PatientDossier } from './PatientDossier';

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const doc = (over: Partial<ConsultAttachment>): ConsultAttachment => ({
    id: 'a1',
    name: 'old-prescription.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 240_000,
    uploadedAt: '2026-11-01T10:00:00.000Z',
    url: 'https://s3.test/a1.jpg?sig=1',
    ...over,
});

function record(attachments: ConsultAttachment[]): DoctorConsultationRecord {
    return {
        id: 'c-1',
        status: 'IN_PROGRESS',
        type: 'VIDEO',
        startsAt: '2026-11-02T10:00:00.000Z',
        slot: { endsAt: '2026-11-02T10:15:00.000Z' },
        patient: { name: 'Sunita Verma', age: 64, gender: 'Female', chronicConditions: ['Diabetes'] },
        patientJoinedAt: '2026-11-02T09:58:00.000Z',
        doctorJoinedAt: '2026-11-02T10:00:00.000Z',
        note: null,
        prescription: null,
        previousVersions: [],
        attachments,
    };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function mount(r: DoctorConsultationRecord) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<PatientDossier record={r} />));
}

afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
});

const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const preview = () => document.querySelector<HTMLElement>('[data-testid="attachment-preview"]');

describe('PatientDossier attached documents', () => {
    const docs = [
        doc({}),
        doc({ id: 'a2', name: 'discharge-summary.pdf', mimeType: 'application/pdf', url: 'https://s3.test/a2.pdf?sig=2' }),
        doc({ id: 'a3', name: 'IMG_2041.heic', mimeType: 'image/heic', url: 'https://s3.test/a3.heic?sig=3' }),
    ];

    it('shows a thumbnail for each uploaded record: the photo itself, or a file icon for PDF / HEIC', async () => {
        await mount(record(docs));
        expect(container!.textContent).toContain('Attached documents');
        expect(button('Open old-prescription.jpg')?.querySelector('img')?.getAttribute('src')).toBe('https://s3.test/a1.jpg?sig=1');
        expect(button('Open discharge-summary.pdf')?.querySelector('img')).toBeNull();
        expect(button('Open IMG_2041.heic')?.querySelector('img')).toBeNull();
        expect(preview()).toBeNull();
    });

    it('opens a large preview on click, steps through documents, and closes', async () => {
        await mount(record(docs));

        await act(async () => button('Open old-prescription.jpg')!.click());
        expect(preview()?.tagName).toBe('IMG');
        expect(preview()?.getAttribute('src')).toBe('https://s3.test/a1.jpg?sig=1');
        expect(document.body.textContent).toContain('1 of 3');

        await act(async () => button('Next document')!.click());
        expect(preview()?.tagName).toBe('IFRAME');
        expect(preview()?.getAttribute('src')).toBe('https://s3.test/a2.pdf?sig=2');

        await act(async () => button('Previous document')!.click());
        await act(async () => button('Previous document')!.click());
        expect(document.body.textContent).toContain('3 of 3');
        expect(preview()?.textContent).toContain('cannot be shown here');

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(preview()).toBeNull();
    });

    it('stays hidden when nothing was shared', async () => {
        await mount({ ...record([]), patient: { name: 'Ravi', age: 40, gender: 'Male' } });
        expect(container!.textContent).toBe('');
    });
});
