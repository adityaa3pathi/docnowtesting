/**
 * Doctor list filters. The server filters, sorts and pages (`GET /consult/doctors?page=`); this file
 * maps the filter state to and from the page URL (so a filtered list can be shared, reloaded or
 * gone back to) and to the API query.
 */
export type DoctorSort = 'recommended' | 'soonest' | 'fee_low' | 'fee_high' | 'experience';

export interface DoctorFilterState {
    /** Part of a doctor's name. */
    q: string;
    /** Online in the doctor panel and free right now (GPs only; see /consult/now). */
    now: boolean;
    languages: string[];
    gender: 'Female' | 'Male' | null;
    minExperience: number | null;
    maxFee: number | null;
    sort: DoctorSort;
    page: number;
}

export const NO_FILTERS: DoctorFilterState = { q: '', now: false, languages: [], gender: null, minExperience: null, maxFee: null, sort: 'recommended', page: 1 };

export const SORT_LABELS: Record<DoctorSort, string> = {
    recommended: 'Recommended',
    soonest: 'Available soonest',
    fee_low: 'Fee: low to high',
    fee_high: 'Fee: high to low',
    experience: 'Most experienced',
};
export const EXPERIENCE_STEPS = [5, 10, 15, 20];
export const FEE_STEPS = [300, 500, 800, 1000];
export const DOCTOR_PAGE_SIZE = 12;
export const SEARCH_MAX = 80;

/** Chosen filters, not counting search, sort or page. */
export function activeFilterCount(f: DoctorFilterState): number {
    return (f.now ? 1 : 0) + (f.languages.length ? 1 : 0) + (f.gender ? 1 : 0) + (f.minExperience !== null ? 1 : 0) + (f.maxFee !== null ? 1 : 0);
}

export function isFiltered(f: DoctorFilterState): boolean {
    return activeFilterCount(f) > 0 || f.q.trim() !== '' || f.sort !== 'recommended';
}

/** Any change but paging starts again at page 1. */
export function withFilters(f: DoctorFilterState, patch: Partial<DoctorFilterState>): DoctorFilterState {
    return { ...f, page: 1, ...patch };
}

const positive = (v: string | null, max: number): number | null => {
    if (!v || !/^\d+$/.test(v)) return null;
    const n = Number(v);
    return n >= 1 && n <= max ? n : null;
};

/** URL keys: q, now=1, lang=Hindi,English, gender, exp, fee, sort, page. Unknown or bad values are dropped, never guessed. */
export function filtersFromParams(p: URLSearchParams): DoctorFilterState {
    const gender = p.get('gender');
    const sort = p.get('sort') as DoctorSort | null;
    const exp = p.get('exp');
    return {
        q: (p.get('q') ?? '').slice(0, SEARCH_MAX),
        now: p.get('now') === '1',
        // Same limits as the server, so an edited link can't leave the list stuck on an error.
        languages: [...new Set((p.get('lang') ?? '').slice(0, 200).split(',').map((l) => l.trim()).filter((l) => l && l.length <= 30))].slice(0, 10),
        gender: gender === 'Female' || gender === 'Male' ? gender : null,
        minExperience: exp !== null && /^\d+$/.test(exp) && Number(exp) <= 60 ? Number(exp) : null,
        maxFee: positive(p.get('fee'), 100_000),
        sort: sort && sort in SORT_LABELS ? sort : 'recommended',
        page: positive(p.get('page'), 1000) ?? 1,
    };
}

/** Writes the filters into `base` (other keys, like `specialty`, are kept); defaults are left out. */
export function filtersToParams(f: DoctorFilterState, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
    const p = new URLSearchParams(base);
    for (const k of ['q', 'now', 'lang', 'gender', 'exp', 'fee', 'sort', 'page']) p.delete(k);
    if (f.q.trim()) p.set('q', f.q.trim());
    if (f.now) p.set('now', '1');
    if (f.languages.length) p.set('lang', f.languages.join(','));
    if (f.gender) p.set('gender', f.gender);
    if (f.minExperience !== null) p.set('exp', String(f.minExperience));
    if (f.maxFee !== null) p.set('fee', String(f.maxFee));
    if (f.sort !== 'recommended') p.set('sort', f.sort);
    if (f.page > 1) p.set('page', String(f.page));
    return p;
}

/** The API query for one page of the list. */
export function directoryQuery(f: DoctorFilterState, specialtyId: string | null): Record<string, string | number> {
    const q: Record<string, string | number> = { page: f.page, pageSize: DOCTOR_PAGE_SIZE, sort: f.sort };
    if (specialtyId) q.specialtyId = specialtyId;
    if (f.q.trim()) q.q = f.q.trim();
    if (f.now) q.now = 1;
    if (f.languages.length) q.lang = f.languages.join(',');
    if (f.gender) q.gender = f.gender;
    if (f.minExperience !== null) q.minExperience = f.minExperience;
    if (f.maxFee !== null) q.maxFee = f.maxFee;
    return q;
}
