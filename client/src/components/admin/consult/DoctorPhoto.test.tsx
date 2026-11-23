// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminDoctor } from '@/lib/consult/types';

const m = vi.hoisted(() => ({
    specialties: vi.fn(), createDoctor: vi.fn(), doctor: vi.fn(), uploadDoctorPhoto: vi.fn(), approve: vi.fn(), push: vi.fn(),
}));
vi.mock('@/lib/consult/api', () => ({
    admin: { specialties: m.specialties, createDoctor: m.createDoctor, doctor: m.doctor, uploadDoctorPhoto: m.uploadDoctorPhoto, approve: m.approve },
    doctor: { uploadPhoto: vi.fn() },
    errorMessage: (e: { message?: string }) => e?.message ?? 'Something went wrong',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { DoctorForm } = await import('./DoctorForm');
const { DoctorDetail } = await import('./DoctorDetail');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has neither; the form previews the picked photo with one.
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => {};
});

const text = () => document.body.textContent ?? '';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const nativeValue = (el: HTMLElement) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
async function fill(id: string, value: string) {
    const el = byId<HTMLInputElement>(id);
    await act(async () => {
        nativeValue(el).call(el, value);
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });
}
async function pickFile(id: string, file: File) {
    const input = byId<HTMLInputElement>(id);
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
}
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'face.jpg', { type: 'image/jpeg' });

let root: ReturnType<typeof createRoot>;
async function render(node: React.ReactNode) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(node));
    await flush();
}

beforeEach(() => {
    for (const fn of Object.values(m)) fn.mockReset();
    m.specialties.mockResolvedValue([{ id: 'sp-1', name: 'General Physician', isActive: true }]);
});
afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
});

describe('Add a doctor form: the photo is required', () => {
    async function fillDetails() {
        await fill('mobile', '9876543210');
        await fill('displayName', 'Dr Asha Rao');
        await fill('specialtyId', 'sp-1');
        await fill('qualification', 'MBBS');
        await fill('registrationNumber', 'RJ-12345');
        await fill('registrationCouncil', 'Rajasthan Medical Council');
        await fill('consultationFee', '500');
    }
    const submit = async () => { await act(async () => { button('Create doctor')!.click(); }); await flush(); };

    it('does not create the doctor without a photo, and says why', async () => {
        await render(<DoctorForm />);
        await fillDetails();
        await submit();
        expect(m.createDoctor).not.toHaveBeenCalled();
        expect(text()).toContain('Add the doctor’s photo. Patients see it when booking.');
    });

    it('also flags the missing photo when other fields are wrong', async () => {
        await render(<DoctorForm />);
        await submit();
        expect(text()).toContain('Enter the 10-digit mobile number');
        expect(text()).toContain('Add the doctor’s photo.');
    });

    it('refuses a file that is not a photo', async () => {
        await render(<DoctorForm />);
        await pickFile('photo', new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' }));
        expect(text()).toContain('Choose a JPG, PNG or WebP photo.');
    });

    it('sends the details with the photo, then opens the new doctor', async () => {
        m.createDoctor.mockResolvedValue({ id: 'doc-1' });
        await render(<DoctorForm />);
        await fillDetails();
        await pickFile('photo', jpeg());
        await submit();
        expect(m.createDoctor).toHaveBeenCalledTimes(1);
        const [body, photo] = m.createDoctor.mock.calls[0];
        expect(body).toMatchObject({ mobile: '9876543210', displayName: 'Dr Asha Rao', specialtyId: 'sp-1', consultationFee: 500 });
        expect(photo).toBeInstanceOf(Blob);
        expect(m.push).toHaveBeenCalledWith('/super-admin/consult-doctors/doc-1');
    });
});

describe('Doctor page: photo and approval', () => {
    const doctor = (over: Partial<AdminDoctor> = {}) => ({
        id: 'doc-1', displayName: 'Dr Asha Rao', status: 'PENDING', consultationFee: 500, slotMinutes: 15, specialty: { name: 'General Physician' },
        qualification: 'MBBS', experienceYears: 4, registrationNumber: 'RJ-1', registrationCouncil: 'RMC', languages: ['English'],
        gender: null, photoUrl: null, statusReason: null, user: { mobile: '9876543210' }, ...over,
    }) as unknown as AdminDoctor;

    it('keeps Approve off until a photo is added, then the admin can add one here', async () => {
        m.doctor.mockResolvedValue(doctor());
        m.uploadDoctorPhoto.mockResolvedValue({ photoUrl: 'https://api.test/api/consult/doctors/doc-1/photo?v=1' });
        await render(<DoctorDetail id="doc-1" />);

        expect(text()).toContain('Not uploaded. Needed before approval.');
        expect(text()).toContain('Add the doctor’s photo above before approving.');
        expect(button('Approve')!.disabled).toBe(true);

        await pickFile('doctor-photo', jpeg());
        expect(m.uploadDoctorPhoto).toHaveBeenCalledWith('doc-1', expect.any(Blob));
        expect(text()).not.toContain('Not uploaded');
        expect(button('Approve')!.disabled).toBe(false);
    });

    it('marks a live doctor without a photo, without suspending them', async () => {
        m.doctor.mockResolvedValue(doctor({ status: 'APPROVED' }));
        await render(<DoctorDetail id="doc-1" />);
        expect(text()).toContain('No photo. Patients see initials instead.');
        expect(button('Suspend')).toBeDefined();
        expect(button('Upload photo')).toBeUndefined(); // it is a label for the file input, not a button
        expect(document.querySelector('label[for="doctor-photo"]')?.textContent).toContain('Upload photo');
    });
});
