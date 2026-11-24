/**
 * The public doctor list (`GET /consult/doctors`): filters, name search, "Online now", sorting and paging.
 *
 * Without `page` the reply is the plain array every older caller (homepage, mobile app) expects. With
 * `page` it is `{ items, total, page, pageSize, languages, onlineSpecialtyId }`. Filtering runs in the database; the sort
 * needs each doctor's next free time and online state, so it runs in memory over the matching
 * doctors. That set is all approved doctors at most (dozens today); revisit if it reaches thousands.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { getActivePolicy } from './consultations.policy.service';
import { freeOnlineDoctorIds, instantSpecialtySlug } from './consultations.instant';
import { withNextSlot } from './doctors.nextSlot';

export const DOCTOR_SORTS = ['recommended', 'soonest', 'fee_low', 'fee_high', 'experience'] as const;
export type DoctorSort = (typeof DOCTOR_SORTS)[number];
export const DIRECTORY_PAGE_SIZE = 12;

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const flag = z.enum(['1', 'true', '0', 'false']).transform((v) => v === '1' || v === 'true');

export const directoryQuery = z.object({
    specialtyId: z.string().uuid().optional(),
    q: z.string().max(80, 'Search is too long').transform((s) => s.trim()).optional(),
    // Comma-separated, any of them matches: ?lang=Hindi,English
    lang: z.string().max(200).transform((s) => [...new Set(s.split(',').map((l) => l.trim()).filter(Boolean))])
        .pipe(z.array(z.string().max(30)).max(10)).optional(),
    gender: z.enum(['Female', 'Male']).optional(),
    minExperience: int(0, 60).optional(),
    maxFee: int(1, 100_000).optional(),
    now: flag.optional(),
    // Left out: 'recommended' for pages; the plain array keeps its old A–Z order (homepage, mobile app).
    sort: z.enum(DOCTOR_SORTS).optional(),
    page: int(1, 1000).optional(),
    pageSize: int(1, 48).default(DIRECTORY_PAGE_SIZE),
});
export type DirectoryQuery = z.infer<typeof directoryQuery>;

export const publicDoctorSelect = {
    id: true, displayName: true, photoUrl: true, qualification: true, experienceYears: true,
    languages: true, bio: true, consultationFee: true, slotMinutes: true, gender: true,
    specialty: { select: { id: true, name: true, slug: true } },
} as const;

type Deps = { db?: PrismaClient; now?: Date };

/**
 * "Dr. Anil" and "anil" find "Dr Anil Mehta": the title is on every name, so it is not searched.
 * Prisma's `contains` passes % and _ to LIKE as wildcards, so they are escaped here.
 */
export function nameSearchTerm(q: string | undefined): string | null {
    const term = (q ?? '').replace(/^\s*dr\.?(\s+|$)/i, '').trim();
    return term ? term.replace(/[\\%_]/g, (c) => `\\${c}`) : null;
}

export async function searchDoctors(query: DirectoryQuery, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const base: Prisma.DoctorProfileWhereInput = { status: 'APPROVED', specialtyId: query.specialtyId };
    const term = nameSearchTerm(query.q);
    const where: Prisma.DoctorProfileWhereInput = {
        ...base,
        ...(term && { displayName: { contains: term, mode: 'insensitive' } }),
        ...(query.lang?.length && { languages: { hasSome: query.lang } }),
        ...(query.gender && { gender: query.gender }),
        ...(query.minExperience !== undefined && { experienceYears: { gte: query.minExperience } }),
        ...(query.maxFee !== undefined && { consultationFee: { lte: query.maxFee } }),
    };
    const { rules } = await getActivePolicy(db);
    const [found, online] = await Promise.all([
        db.doctorProfile.findMany({ where, select: publicDoctorSelect, orderBy: { displayName: 'asc' } }),
        freeOnlineDoctorIds(db, now),
    ]);
    const earliest = new Date(now.getTime() + rules.minLeadMinutes * 60_000);
    // People pick a doctor by when they can be seen: one grouped query adds each doctor's next bookable time.
    const next = found.length
        ? await db.slot.groupBy({
            by: ['doctorId'],
            where: { doctorId: { in: found.map((d) => d.id) }, status: 'AVAILABLE', startsAt: { gt: earliest } },
            _min: { startsAt: true },
        })
        : [];
    const all = withNextSlot(found, next).map((d) => ({ ...d, onlineNow: online.has(d.id) }));
    const kept = query.now ? all.filter((d) => d.onlineNow) : all;
    const sort = query.sort ?? (query.page === undefined ? null : 'recommended');
    return sort ? sortDoctors(kept, sort) : kept;
}

type Sortable = { displayName: string; consultationFee: number; experienceYears: number; nextSlotAt: string | null; onlineNow: boolean };
const soonest = (d: Sortable) => (d.nextSlotAt ? Date.parse(d.nextSlotAt) : Number.POSITIVE_INFINITY);
const SORTS: Record<DoctorSort, (a: Sortable, b: Sortable) => number> = {
    // Who can see you soonest: online now first, then the next free time, then experience.
    recommended: (a, b) => Number(b.onlineNow) - Number(a.onlineNow) || soonest(a) - soonest(b) || b.experienceYears - a.experienceYears,
    soonest: (a, b) => soonest(a) - soonest(b),
    fee_low: (a, b) => a.consultationFee - b.consultationFee,
    fee_high: (a, b) => b.consultationFee - a.consultationFee,
    experience: (a, b) => b.experienceYears - a.experienceYears,
};

/** Stable: ties fall back to the name, so pages never swap doctors between requests. */
export function sortDoctors<T extends Sortable & { id: string }>(doctors: T[], sort: DoctorSort): T[] {
    return [...doctors].sort((a, b) => SORTS[sort](a, b) || a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
}

/** Languages offered in this specialty (other filters ignored, so the menu doesn't shrink as you pick), most common first. */
export async function directoryLanguages(specialtyId: string | undefined, deps: Deps = {}): Promise<string[]> {
    const db = deps.db ?? prisma;
    const rows = await db.doctorProfile.findMany({ where: { status: 'APPROVED', specialtyId }, select: { languages: true } });
    const count = new Map<string, number>();
    for (const r of rows) for (const l of r.languages) count.set(l, (count.get(l) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

export async function listDirectory(query: DirectoryQuery, deps: Deps = {}) {
    const doctors = await searchDoctors(query, deps);
    if (query.page === undefined) return doctors;
    const { page, pageSize } = query;
    return {
        items: doctors.slice((page - 1) * pageSize, page * pageSize),
        total: doctors.length,
        page,
        pageSize,
        languages: await directoryLanguages(query.specialtyId, deps),
        // Only this specialty can be "Online now", so the page can say so for any other.
        onlineSpecialtyId: (await (deps.db ?? prisma).specialty.findFirst({ where: { slug: instantSpecialtySlug() }, select: { id: true } }))?.id ?? null,
    };
}
