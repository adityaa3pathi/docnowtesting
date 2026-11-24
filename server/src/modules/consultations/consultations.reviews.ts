/**
 * P11 reviews: patients rate the doctor after a completed consultation, anyone signed in rates DocNow,
 * and a super admin moderates both.
 *
 * Rules (Aditya, 2026-11-24, from the owner sheet rows 19 to 21):
 * - A doctor review is written by the booker or an accepted family member, once per consultation,
 *   within 48 h of its end. Nobody edits it afterwards; the doctor only reads.
 * - Only VISIBLE reviews are shown and counted. The average shows once a doctor has 3.
 * - Moderation is hide, unhide, delete (soft), reply and redact personal data (marked "edited by
 *   DocNow"). DocNow never writes reviews itself: under India's fake-review rules (CCPA guidance,
 *   IS 19000:2022) reviews posted as patients' would be a legal risk.
 * - Public pages never name the author ("Verified patient"): a review says who saw which doctor.
 */
import { Prisma, PrismaClient, ReviewStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { logger } from '../../utils/logger';
import { DoctorError } from './doctors.status';
import { accessFor, canSeeClinical, userMobile } from './consultations.family';

export const REVIEW_WINDOW_MS = 48 * 3_600_000;
/** Visible reviews a doctor needs before the average is shown (Aditya, 2026-11-24). */
export const RATING_MIN_COUNT = 3;
export const REVIEW_TEXT_MAX = 1000;
export const REVIEWS_PAGE_SIZE = 10;
export const ADMIN_REVIEWS_PAGE_SIZE = 25;

// Line breaks are kept; other control characters are refused.
const NO_CONTROL = /^[^\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]*$/;
const reviewText = z.string().max(REVIEW_TEXT_MAX * 2).transform((s) => s.trim())
    .pipe(z.string().max(REVIEW_TEXT_MAX, `Keep it under ${REVIEW_TEXT_MAX} characters`).regex(NO_CONTROL, 'Remove special characters from the text'))
    .transform((s) => s || null);

export const reviewSchema = z.object({
    rating: z.number({ error: 'Choose 1 to 5 stars' }).int('Choose 1 to 5 stars').min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars'),
    text: reviewText.nullish().transform((t) => t ?? null),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

type Db = PrismaClient;
type Deps = { db?: Db; now?: Date };

// ── Shared shapes ───────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The average and count, or null below RATING_MIN_COUNT so one or two reviews never set the stars. */
export function publicRating(r: { average: number; count: number } | undefined): { average: number; count: number } | null {
    return r && r.count >= RATING_MIN_COUNT ? r : null;
}

/** Visible-review averages for these doctors, whatever the count. */
export async function doctorRatings(doctorIds: string[], db: Db = prisma): Promise<Map<string, { average: number; count: number }>> {
    if (!doctorIds.length) return new Map();
    const rows = await db.doctorReview.groupBy({
        by: ['doctorId'],
        where: { doctorId: { in: doctorIds }, status: 'VISIBLE' },
        _avg: { rating: true },
        _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.doctorId, { average: round1(r._avg.rating ?? 0), count: r._count._all }]));
}

type ReviewRow = { id: string; rating: number; text: string | null; createdAt: Date; redactedAt: Date | null; replyText: string | null; repliedAt: Date | null };

/** What anyone may see of a visible review: no author, no consultation. */
function publicView(r: ReviewRow) {
    return {
        id: r.id,
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
        editedByDocNow: !!r.redactedAt,
        reply: r.replyText ? { text: r.replyText, at: r.repliedAt?.toISOString() ?? null } : null,
    };
}
const publicSelect = { id: true, rating: true, text: true, createdAt: true, redactedAt: true, replyText: true, repliedAt: true } as const;

/** The author's own view adds whether DocNow took it down. */
function ownView(r: ReviewRow & { status: ReviewStatus }) {
    return { ...publicView(r), status: r.status };
}

const pageOf = (page: number, size: number) => ({ skip: (page - 1) * size, take: size });

// ── Doctor reviews: the patient side ────────────────────

type Reviewable = { status: string; endedAt: Date | null };

/** Open from the doctor ending the call until 48 h later. */
export function reviewClosesAt(c: Reviewable): Date | null {
    return c.status === 'COMPLETED' && c.endedAt ? new Date(c.endedAt.getTime() + REVIEW_WINDOW_MS) : null;
}
export function reviewOpen(c: Reviewable, now: Date): boolean {
    const closes = reviewClosesAt(c);
    return !!closes && now.getTime() < closes.getTime();
}

/** The review block of the booking page (booker or accepted family member). */
export async function bookingReviewState(c: Reviewable & { id: string }, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const review = await db.doctorReview.findUnique({ where: { consultationId: c.id }, select: { ...publicSelect, status: true } });
    const closes = reviewClosesAt(c);
    return {
        review: review ? ownView(review) : null,
        canReview: !review && reviewOpen(c, now),
        closesAt: closes?.toISOString() ?? null,
    };
}

export async function submitDoctorReview(userId: string, consultationId: string, input: ReviewInput, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const c = await db.consultation.findUnique({
        where: { id: consultationId },
        select: {
            id: true, userId: true, doctorId: true, status: true, endedAt: true,
            patient: { select: { relation: true, phone: true, linkedUserId: true, linkDeclinedAt: true } },
        },
    });
    const access = c && accessFor(c, userId, c.userId === userId ? null : await userMobile(db, userId));
    // Someone who may not see the consultation in full learns nothing about it.
    if (!c || !access || !canSeeClinical(access)) throw new DoctorError(404, 'Not found');
    if (c.status !== 'COMPLETED' || !c.endedAt) throw new DoctorError(409, 'You can review the doctor once the consultation is over');
    if (!reviewOpen(c, now)) throw new DoctorError(409, 'Reviews close 48 hours after the consultation');
    try {
        const review = await db.doctorReview.create({
            data: { consultationId: c.id, doctorId: c.doctorId, authorUserId: userId, rating: input.rating, text: input.text },
            select: { ...publicSelect, status: true },
        });
        logger.info({ consultationId: c.id, doctorId: c.doctorId, rating: input.rating }, 'doctor_review_created');
        return ownView(review);
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DoctorError(409, 'This consultation already has a review');
        throw e;
    }
}

// ── Doctor reviews: public and the doctor's own ─────────

export async function publicDoctorReviews(doctorId: string, page: number, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const doctor = await db.doctorProfile.findFirst({ where: { id: doctorId, status: 'APPROVED' }, select: { id: true } });
    if (!doctor) throw new DoctorError(404, 'Doctor not found');
    const where = { doctorId, status: 'VISIBLE' as const };
    const [items, total, ratings] = await Promise.all([
        db.doctorReview.findMany({ where, select: publicSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...pageOf(page, REVIEWS_PAGE_SIZE) }),
        db.doctorReview.count({ where }),
        doctorRatings([doctorId], db),
    ]);
    return { items: items.map(publicView), total, page, pageSize: REVIEWS_PAGE_SIZE, rating: publicRating(ratings.get(doctorId)) };
}

/** The doctor panel: their visible reviews, read-only, without the author. */
export async function doctorOwnReviews(doctorProfileId: string, page: number, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const where = { doctorId: doctorProfileId, status: 'VISIBLE' as const };
    const [items, total, ratings] = await Promise.all([
        db.doctorReview.findMany({ where, select: publicSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...pageOf(page, REVIEWS_PAGE_SIZE) }),
        db.doctorReview.count({ where }),
        doctorRatings([doctorProfileId], db),
    ]);
    const r = ratings.get(doctorProfileId);
    return {
        items: items.map(publicView), total, page, pageSize: REVIEWS_PAGE_SIZE,
        average: r?.average ?? null,
        shownPublicly: !!publicRating(r),
        minCountToShow: RATING_MIN_COUNT,
    };
}

// ── App reviews ─────────────────────────────────────────

export async function myAppReview(userId: string, db: Db = prisma) {
    const r = await db.appReview.findUnique({ where: { userId }, select: { ...publicSelect, status: true, updatedAt: true } });
    return r ? { ...ownView(r), updatedAt: r.updatedAt.toISOString() } : null;
}

/** Writes or changes this account's review of DocNow. Hidden stays hidden; a deleted one is closed. */
export async function saveAppReview(userId: string, input: ReviewInput, db: Db = prisma) {
    const existing = await db.appReview.findUnique({ where: { userId }, select: { status: true, text: true, redactedAt: true } });
    if (existing?.status === 'DELETED') throw new DoctorError(409, 'DocNow removed your review, so it can no longer be changed');
    if (!existing) {
        try {
            await db.appReview.create({ data: { userId, rating: input.rating, text: input.text } });
        } catch (e) {
            // Two tabs saving at once: the second becomes an edit.
            if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
            return saveAppReview(userId, input, db);
        }
    } else {
        // New wording from the author replaces DocNow's redaction; the same wording keeps the mark.
        const textChanged = input.text !== existing.text;
        const res = await db.appReview.updateMany({
            where: { userId, status: { not: 'DELETED' } },
            data: { rating: input.rating, text: input.text, ...(textChanged ? { redactedAt: null } : {}) },
        });
        if (res.count !== 1) throw new DoctorError(409, 'DocNow removed your review, so it can no longer be changed');
    }
    return (await myAppReview(userId, db))!;
}

export async function publicAppReviews(page: number, db: Db = prisma) {
    const where = { status: 'VISIBLE' as const };
    const [items, total, agg] = await Promise.all([
        db.appReview.findMany({ where, select: publicSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...pageOf(page, REVIEWS_PAGE_SIZE) }),
        db.appReview.count({ where }),
        db.appReview.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
    ]);
    const rating = publicRating({ average: round1(agg._avg.rating ?? 0), count: agg._count._all });
    return { items: items.map(publicView), total, page, pageSize: REVIEWS_PAGE_SIZE, rating };
}

// ── Super admin moderation ──────────────────────────────

export const REVIEW_KINDS = ['doctor', 'app'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const MODERATIONS = ['hide', 'unhide', 'delete', 'redact', 'reply'] as const;
export type Moderation = (typeof MODERATIONS)[number];

export const adminListQuery = z.object({
    kind: z.enum(REVIEW_KINDS).default('doctor'),
    status: z.enum(['VISIBLE', 'HIDDEN', 'DELETED']).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    doctorId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type AdminListQuery = z.infer<typeof adminListQuery>;

const reason = z.string().trim().min(3, 'A reason is required').max(200);
export const moderationSchemas = {
    hide: z.object({ reason }),
    unhide: z.object({ reason }),
    delete: z.object({ reason }),
    // The review's own words with the personal data taken out; empty removes the text.
    redact: z.object({ text: reviewText.nullable(), reason }),
    // Empty or null takes the reply down.
    reply: z.object({ text: z.string().max(REVIEW_TEXT_MAX * 2).transform((s) => s.trim())
        .pipe(z.string().max(REVIEW_TEXT_MAX, `Keep it under ${REVIEW_TEXT_MAX} characters`).regex(NO_CONTROL, 'Remove special characters from the text'))
        .nullable() }),
} satisfies Record<Moderation, z.ZodTypeAny>;

const adminSelect = {
    id: true, rating: true, text: true, status: true, createdAt: true, updatedAt: true, redactedAt: true, replyText: true, repliedAt: true,
} as const;

export async function adminListReviews(q: AdminListQuery, db: Db = prisma) {
    const size = ADMIN_REVIEWS_PAGE_SIZE;
    const order = [{ createdAt: 'desc' as const }, { id: 'asc' as const }];
    if (q.kind === 'doctor') {
        const where: Prisma.DoctorReviewWhereInput = { status: q.status, rating: q.rating, doctorId: q.doctorId };
        const [rows, total] = await Promise.all([
            db.doctorReview.findMany({
                where, orderBy: order, ...pageOf(q.page, size),
                select: {
                    ...adminSelect, consultationId: true,
                    doctor: { select: { id: true, displayName: true } },
                    author: { select: { id: true, name: true, mobile: true } },
                    consultation: { select: { startsAt: true, patient: { select: { name: true } } } },
                },
            }),
            db.doctorReview.count({ where }),
        ]);
        const items = rows.map(({ consultation, ...r }) => ({ ...r, kind: 'doctor' as const, consultationStartsAt: consultation.startsAt, patientName: consultation.patient.name }));
        return { items, total, page: q.page, pageSize: size };
    }
    const where: Prisma.AppReviewWhereInput = { status: q.status, rating: q.rating };
    const [rows, total] = await Promise.all([
        db.appReview.findMany({ where, orderBy: order, ...pageOf(q.page, size), select: { ...adminSelect, user: { select: { id: true, name: true, mobile: true } } } }),
        db.appReview.count({ where }),
    ]);
    return { items: rows.map(({ user, ...r }) => ({ ...r, kind: 'app' as const, author: user })), total, page: q.page, pageSize: size };
}

type Actor = { adminId: string; adminName: string; ipAddress: string | null };

/** Which states each action starts from: a changed state since the admin loaded the page is a 409. */
const FROM: Record<Moderation, ReviewStatus[]> = {
    hide: ['VISIBLE'],
    unhide: ['HIDDEN'],
    delete: ['VISIBLE', 'HIDDEN'],
    redact: ['VISIBLE', 'HIDDEN'],
    reply: ['VISIBLE', 'HIDDEN'],
};

/**
 * One moderation step, with its audit row in the same transaction. The audit never copies review
 * text: a redaction exists to remove personal data, so its old wording is not kept anywhere.
 */
export async function moderateReview(
    kind: ReviewKind, id: string, action: Moderation, body: unknown, actor: Actor, deps: Deps = {},
) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const parsed = moderationSchemas[action].safeParse(body ?? {});
    if (!parsed.success) throw new DoctorError(400, parsed.error.issues[0].message);
    const input = parsed.data as { reason?: string; text?: string | null };

    let data: Prisma.DoctorReviewUpdateManyMutationInput & Prisma.AppReviewUpdateManyMutationInput;
    switch (action) {
        case 'hide': data = { status: 'HIDDEN' }; break;
        case 'unhide': data = { status: 'VISIBLE' }; break;
        case 'delete': data = { status: 'DELETED' }; break;
        case 'redact': data = { text: input.text ?? null, redactedAt: now }; break;
        case 'reply': data = input.text ? { replyText: input.text, repliedAt: now } : { replyText: null, repliedAt: null }; break;
    }

    const entity = kind === 'doctor' ? 'DoctorReview' : 'AppReview';
    return db.$transaction(async (tx) => {
        const where = { id, status: { in: FROM[action] } };
        const current = kind === 'doctor'
            ? await tx.doctorReview.findUnique({ where: { id }, select: { status: true } })
            : await tx.appReview.findUnique({ where: { id }, select: { status: true } });
        if (!current) throw new DoctorError(404, 'Review not found');
        const res = kind === 'doctor' ? await tx.doctorReview.updateMany({ where, data }) : await tx.appReview.updateMany({ where, data });
        if (res.count !== 1) {
            throw new DoctorError(409, current.status === 'DELETED' ? 'This review was deleted' : `This review is already ${current.status.toLowerCase()}`);
        }
        await tx.adminAuditLog.create({
            data: {
                adminId: actor.adminId,
                adminName: actor.adminName,
                action: `REVIEW_${action.toUpperCase()}`,
                entity,
                targetId: id,
                oldValue: { status: current.status },
                newValue: {
                    ...(input.reason ? { reason: input.reason } : {}),
                    ...(action === 'reply' ? { reply: input.text || null } : {}),
                    ...(action === 'redact' ? { textRemoved: !input.text } : {}),
                    status: data.status ?? current.status,
                },
                ipAddress: actor.ipAddress,
                isDestructive: action === 'delete' || action === 'redact',
            },
        });
        const row = kind === 'doctor'
            ? await tx.doctorReview.findUniqueOrThrow({ where: { id }, select: adminSelect })
            : await tx.appReview.findUniqueOrThrow({ where: { id }, select: adminSelect });
        return { ...row, kind };
    });
}
