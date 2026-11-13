// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoctorSummary } from '@/lib/consult/types';
import { consult } from '@/lib/consult/api';
import { CareLoop } from './CareLoop';
import { FamilyCareSpotlight } from './FamilyCareSpotlight';
import { FeaturedDoctors } from './FeaturedDoctors';
import { FeaturedSpecialties } from './FeaturedSpecialties';
import { HeroDualPillars, HeroStatsCard } from './HeroDualPillars';
import { resetDoctorDirectoryForTests } from './useDoctorDirectory';

vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/useGlobalSearch', () => ({ useGlobalSearch: () => ({ results: [], isLoading: false, isError: false }) }));
vi.mock('@/lib/consult/api', () => ({
    consult: { doctors: vi.fn() },
    errorMessage: () => 'Network error',
}));

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const doctor = (over: Partial<DoctorSummary>): DoctorSummary => ({
    id: 'd-1',
    displayName: 'Dr. Rajesh Sharma',
    photoUrl: null,
    qualification: 'MBBS, MD - Internal Medicine',
    experienceYears: 12,
    languages: ['Hindi', 'English'],
    bio: null,
    consultationFee: 499,
    slotMinutes: 15,
    specialty: { id: 's-gp', name: 'General Physician', slug: 'general-physician' },
    ...over,
});
const DOCTORS = [
    doctor({}),
    doctor({ id: 'd-2', displayName: 'Dr. Neha Kapoor', qualification: 'MBBS, MD (Dermatology)', experienceYears: 8, consultationFee: 299, specialty: { id: 's-d', name: 'Dermatology', slug: 'dermatology' } }),
];

let root: Root | null = null;
let host: HTMLElement | null = null;
async function mount(ui: ReactNode) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(ui));
    // Let the mocked doctor request resolve and the islands re-render.
    await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    return host;
}
const $ = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
    resetDoctorDirectoryForTests();
    vi.mocked(consult.doctors).mockReset();
    vi.mocked(consult.doctors).mockResolvedValue(DOCTORS);
});
afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
});

describe('dual-pillar hero', () => {
    it('gives doctor consultations and lab tests equal cards with the right routes', async () => {
        const el = await mount(<HeroDualPillars />);
        expect(el.querySelector('h1')?.textContent).toContain('Complete Healthcare, Delivered Home');
        expect($(el, 'hero-card-consult')?.textContent).toContain('Video Doctor Consultation');
        expect($(el, 'hero-card-tests')?.textContent).toContain('NABL & CAP Accredited Labs');
        expect($(el, 'hero-cta-consult')?.getAttribute('href')).toBe('/consult');
        expect($(el, 'hero-cta-tests')?.getAttribute('href')).toBe('/search?type=TEST');
        // The "from" price is the lowest real fee, never a made-up one.
        expect($(el, 'hero-cta-consult')?.textContent).toContain('Consult a Doctor (From ₹299)');
    });

    it('leaves the price out when no doctor fee is known', async () => {
        vi.mocked(consult.doctors).mockRejectedValue(new Error('offline'));
        const el = await mount(<HeroDualPillars />);
        expect($(el, 'consult-from-fee')).toBeNull();
        expect($(el, 'hero-cta-consult')?.textContent).toContain('Consult a Doctor');
    });

    it('searches doctors by symptom from the hero search box', async () => {
        const el = await mount(<HeroDualPillars />);
        const input = $(el, 'hero-search-input') as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        await act(async () => {
            setter.call(input, 'acne');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const results = $(el, 'hero-search-results');
        expect(results?.textContent).toContain('Dr. Neha Kapoor');
        expect(results?.textContent).not.toContain('Dr. Rajesh Sharma');
        expect(results?.querySelector('a[href="/consult/doctors/d-2"]')).not.toBeNull();
    });

    it('shows the live verified doctor count in the stats strip', async () => {
        const el = await mount(<HeroStatsCard />);
        expect($(el, 'doctor-count')?.textContent).toBe('2');
        expect(el.textContent).toContain('50K+');
        expect(el.textContent).toContain('Verified Doctors');
    });
});

describe('specialty grid', () => {
    it('renders 8 specialties, each linking to its consult filter', async () => {
        const el = await mount(<FeaturedSpecialties />);
        const links = [...el.querySelectorAll<HTMLAnchorElement>('[data-testid^="specialty-"]')].filter((a) => a.tagName === 'A');
        expect(links).toHaveLength(8);
        expect(links.map((a) => a.getAttribute('href'))).toEqual([
            '/consult?specialty=general-physician',
            '/consult?specialty=dermatologist',
            '/consult?specialty=gynecologist',
            '/consult?specialty=pediatrician',
            '/consult?specialty=orthopedist',
            '/consult?specialty=cardiologist',
            '/consult?specialty=psychiatrist',
            '/consult?specialty=gastroenterologist',
        ]);
        expect($(el, 'specialty-dermatologist')?.textContent).toContain('Acne');
        expect($(el, 'specialty-dermatologist')?.textContent).toContain('Consult Now');
    });
});

describe('featured doctors', () => {
    it('shows name, credentials, experience, languages and fee, with Book Slot', async () => {
        const el = await mount(<FeaturedDoctors />);
        const card = $(el, 'home-doctor-d-1')!;
        expect(card.textContent).toContain('Dr. Rajesh Sharma');
        expect(card.textContent).toContain('General Physician');
        expect(card.textContent).toContain('MBBS, MD - Internal Medicine');
        expect(card.textContent).toContain('12 yrs exp');
        expect(card.textContent).toContain('Hindi, English');
        expect(card.textContent).toContain('₹499');
        expect(card.textContent).toContain('Verified Doctor');
        expect(card.querySelector('a[href="/consult/doctors/d-1"]')?.textContent).toContain('Book Slot');
        expect(el.textContent).toContain('View all 2 doctors');
    });

    it('offers a retry when the doctors cannot be loaded', async () => {
        vi.mocked(consult.doctors).mockRejectedValueOnce(new Error('offline'));
        const el = await mount(<FeaturedDoctors />);
        expect(el.querySelector('[role="alert"]')?.textContent).toContain('We could not load our doctors right now.');
        const retry = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Try again'))!;
        await act(async () => retry.click());
        await act(async () => {
            for (let i = 0; i < 5; i++) await Promise.resolve();
        });
        expect($(el, 'home-doctor-d-2')).not.toBeNull();
        expect(consult.doctors).toHaveBeenCalledTimes(2);
    });
});

describe('care loop and family care', () => {
    it('walks through consult, prescription, home collection and reports', async () => {
        const el = await mount(<CareLoop />);
        const steps = [...el.querySelectorAll('[data-testid="care-loop"] > li h3')].map((h) => h.textContent);
        expect(steps).toEqual(['Consult a Doctor Online', 'Digital Prescription', '1-Tap Home Sample Collection', 'Digital Reports']);
    });

    it('spotlights assisted family consultations with a booking CTA', async () => {
        const el = await mount(<FamilyCareSpotlight />);
        expect(el.textContent).toContain('Caring for Your Parents, Even When You’re Miles Away');
        expect(el.textContent).toContain('No app or login for your parents');
        expect($(el, 'family-cta')?.getAttribute('href')).toBe('/consult');
    });
});
