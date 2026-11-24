/**
 * The patient's DocNow health record, and who may see it.
 *
 * - Medical records vault: photos and PDFs a patient keeps per person (self or family), outside any
 *   booking. Only the owning account manages them.
 * - Sharing: per booking, the patient ticks "let the doctor see my health record" (unticked by
 *   default; DPDP Act consent needs a clear yes). The booker or the accepted family member can switch
 *   it off, or on, later. Every switch is kept in RecordShareConsent with the wording version.
 * - The doctor of a paid booking with sharing on sees the person's whole DocNow record (lab reports,
 *   past consultations with every doctor's notes and prescriptions, vault files, P8 vitals) from payment until
 *   7 days after the visit ends (Aditya, 2026-11-23). Every view and every file opened is logged in
 *   HealthRecordAccess. Outside the window, or without the tick, the doctor sees only what was
 *   attached to the booking, as before.
 */
import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { createReportAccessToken } from '../../services/reportAccess';
import { logger } from '../../utils/logger';
import { DoctorError } from './doctors.status';
import { canSeeClinical, resolveAccess } from './consultations.family';
import { MAX_ATTACHMENT_BYTES, cleanFileName, s3AttachmentStorage, sniffType, type AttachmentStorage } from './consultations.attachments';
import type { ConsultationStatus } from './consultations.types';
import { vitalsForRecord } from './consultations.vitals';

/** Which consent wording the patient was shown. Bump it whenever the text changes. */
export const RECORD_SHARE_VERSION = 'record-share-v2';
/**
 * v1 named lab reports, consultations, prescriptions and files. v2 adds vitals (BP, sugar, periods,
 * P8). A consent sent without a version is stored as v1: it cannot be assumed to cover vitals.
 */
export const LEGACY_RECORD_SHARE_VERSION = 'record-share-v1';
export const VITALS_SHARE_VERSIONS: readonly string[] = ['record-share-v2'];
export const RECORD_ACCESS_DAYS = 7;
export const RECORD_ACCESS_MS = RECORD_ACCESS_DAYS * 24 * 3_600_000;
export const MAX_DOCUMENTS_PER_PERSON = 50;
/** Signed links the doctor gets: short, because each open is logged separately. */
export const DOCTOR_LINK_SECONDS = 10 * 60;
const PATIENT_LINK_SECONDS = 60 * 60;
const PAST_CONSULTATIONS = 30;
const REPORTS = 50;

/** Paid and not called off: the doctor may see a shared record. */
const PAID: ConsultationStatus[] = ['CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED'];
/** The patient may switch sharing on while the booking is held or paid; off at any time. */
const CAN_SHARE: ConsultationStatus[] = ['PENDING_PAYMENT', ...PAID];

/** `system`: switched off by DocNow itself (booking moved to another doctor, account deleted). */
export type ShareMeta = { channel?: 'web' | 'app' | 'system'; ipAddress?: string | null; userAgent?: string | null; version?: string };
export type RecordClosedReason = 'NOT_SHARED' | 'NOT_ACTIVE' | 'ENDED';

type WindowInput = { status: ConsultationStatus | string; recordSharedAt: Date | null; endedAt: Date | null; slot: { endsAt: Date } };

/** When the doctor's access ends: 7 days after the visit (its actual end, or the slot's end). */
export const recordAccessUntil = (c: Pick<WindowInput, 'endedAt' | 'slot'>) => new Date((c.endedAt ?? c.slot.endsAt).getTime() + RECORD_ACCESS_MS);

export function recordWindow(c: WindowInput, now: Date): { open: true; until: Date } | { open: false; reason: RecordClosedReason; until: Date } {
    const until = recordAccessUntil(c);
    if (!c.recordSharedAt) return { open: false, reason: 'NOT_SHARED', until };
    if (!PAID.includes(c.status as ConsultationStatus)) return { open: false, reason: 'NOT_ACTIVE', until };
    if (now.getTime() > until.getTime()) return { open: false, reason: 'ENDED', until };
    return { open: true, until };
}

// ── Patient: the vault ──────────────────────────────────

type VaultDeps = { db?: PrismaClient; storage?: AttachmentStorage };

export interface DocumentView {
    id: string;
    patientId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: Date;
    /** Signed, expires within the hour. */
    url: string;
}

async function ownPerson(db: Pick<PrismaClient, 'patient'>, userId: string, patientId: string) {
    const p = await db.patient.findFirst({ where: { id: patientId, userId }, select: { id: true } });
    if (!p) throw new DoctorError(404, 'Not found');
    return p;
}

async function documentView(storage: AttachmentStorage, d: { id: string; patientId: string; name: string; mimeType: string; sizeBytes: number; createdAt: Date; storageKey: string }): Promise<DocumentView> {
    return { id: d.id, patientId: d.patientId, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedAt: d.createdAt, url: await storage.signedUrl(d.storageKey, PATIENT_LINK_SECONDS, d.name) };
}

/** One person's files, newest first, with signed links. Another account's person reads as missing. */
export async function listDocuments(userId: string, patientId: string, deps: VaultDeps = {}) {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    await ownPerson(db, userId, patientId);
    const rows = await db.patientDocument.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } });
    return { documents: await Promise.all(rows.map((r) => documentView(storage, r))), max: MAX_DOCUMENTS_PER_PERSON };
}

export async function uploadDocument(userId: string, patientId: string, file: { buffer: Buffer; originalname?: string }, deps: VaultDeps = {}) {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    await ownPerson(db, userId, patientId);
    if (!file.buffer.length) throw new DoctorError(400, 'The file is empty');
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) throw new DoctorError(413, 'Files can be up to 10 MB');
    const type = sniffType(file.buffer);
    if (!type) throw new DoctorError(415, 'Upload a photo (JPEG, PNG, WebP, HEIC) or a PDF');
    const full = () => new DoctorError(409, `You can keep up to ${MAX_DOCUMENTS_PER_PERSON} files per person. Delete one to add another.`);
    // Cheap early answer; the locked count below is the real limit.
    if ((await db.patientDocument.count({ where: { patientId } })) >= MAX_DOCUMENTS_PER_PERSON) throw full();

    const id = randomUUID();
    const storageKey = `records/${userId}/${id}.${type.ext}`;
    await storage.put(storageKey, file.buffer, type.mime);
    try {
        const row = await db.$transaction(async (tx) => {
            // One upload per person at a time, so parallel uploads cannot pass the limit together.
            await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patientId} FOR UPDATE`;
            if ((await tx.patientDocument.count({ where: { patientId } })) >= MAX_DOCUMENTS_PER_PERSON) throw full();
            return tx.patientDocument.create({
                data: { id, userId, patientId, storageKey, name: cleanFileName(file.originalname, type.ext), mimeType: type.mime, sizeBytes: file.buffer.length },
            });
        });
        return documentView(storage, row);
    } catch (e) {
        // Over the limit, or the person was removed meanwhile: don't leave an orphan file in storage.
        await storage.remove(storageKey).catch(() => {});
        throw e;
    }
}

/** Deletes the file for good, including from storage. Doctors lose it at once. */
export async function removeDocument(userId: string, id: string, deps: VaultDeps = {}) {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    const row = await db.patientDocument.findFirst({ where: { id, userId } });
    if (!row) throw new DoctorError(404, 'Not found');
    await db.patientDocument.delete({ where: { id: row.id } });
    await storage.remove(row.storageKey).catch(() => {});
    return { id, removed: true };
}

// ── Patient: sharing consent ────────────────────────────

type ShareTx = Pick<Prisma.TransactionClient, 'consultation' | 'recordShareConsent'>;

/**
 * Switches sharing on or off, compare-and-set, so two taps at once leave one consent row. Returns
 * whether anything changed. Callers check who may do it.
 */
export async function writeRecordSharing(tx: ShareTx, consultationId: string, userId: string | null, share: boolean, meta: ShareMeta, now: Date) {
    const res = await tx.consultation.updateMany({
        where: { id: consultationId, recordSharedAt: share ? null : { not: null } },
        data: { recordSharedAt: share ? now : null },
    });
    if (res.count === 0) return false;
    await tx.recordShareConsent.create({
        data: {
            consultationId,
            userId,
            granted: share,
            version: meta.version ?? LEGACY_RECORD_SHARE_VERSION,
            channel: meta.channel ?? 'web',
            ipAddress: meta.ipAddress ?? null,
            userAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
    });
    return true;
}

/** "Let the doctor see my health record" on a booking, by the booker or the accepted family member. */
export async function setRecordSharing(userId: string, consultationId: string, share: boolean, meta: ShareMeta, db: PrismaClient = prisma, now = new Date()) {
    const found = await resolveAccess(userId, consultationId, db);
    if (!found || !canSeeClinical(found.access)) throw new DoctorError(404, 'Not found');
    const c = await db.consultation.findUniqueOrThrow({ where: { id: consultationId }, select: sharingSelect });
    if (share && !canShareNow(c, now)) throw new DoctorError(409, 'This booking has ended, so its sharing cannot be switched on');
    const changed = await db.$transaction((tx) => writeRecordSharing(tx, consultationId, userId, share, meta, now));
    if (changed) logger.info({ consultationId, share }, 'record_sharing_changed');
    const fresh = await db.consultation.findUniqueOrThrow({ where: { id: consultationId }, select: sharingSelect });
    return recordSharingView({ id: consultationId, ...fresh }, db, now);
}

const sharingSelect = { status: true, holdExpiresAt: true, recordSharedAt: true, endedAt: true, slot: { select: { endsAt: true } } } as const;
type SharingRow = { id: string; status: string; holdExpiresAt: Date; recordSharedAt: Date | null; endedAt: Date | null; slot: { endsAt: Date } };

/** Sharing can be switched on: a live hold or a paid booking, before the access window has passed. */
export function canShareNow(c: Omit<SharingRow, 'id' | 'recordSharedAt'>, now: Date) {
    const held = c.status !== 'PENDING_PAYMENT' || c.holdExpiresAt > now;
    return held && CAN_SHARE.includes(c.status as ConsultationStatus) && now.getTime() <= recordAccessUntil(c).getTime();
}

/** What the booking page shows: on or off, until when, and when the doctor last opened it. */
export async function recordSharingView(c: SharingRow, db: Pick<PrismaClient, 'healthRecordAccess'> = prisma, now = new Date()) {
    const last = await db.healthRecordAccess.findFirst({ where: { consultationId: c.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    const until = recordAccessUntil(c);
    const live = canShareNow(c, now);
    return {
        shared: !!c.recordSharedAt,
        sharedAt: c.recordSharedAt,
        until,
        /** Switching on is possible; switching off always is while it is on. */
        canShare: live,
        lastViewedAt: last?.createdAt ?? null,
        version: RECORD_SHARE_VERSION,
    };
}

// ── Doctor: reading the shared record ───────────────────

type ReadDeps = { db?: PrismaClient; storage?: AttachmentStorage; now?: () => Date };
type AccessMeta = { ipAddress?: string | null };

async function sharedConsultation(db: PrismaClient, doctorId: string, consultationId: string) {
    const c = await db.consultation.findFirst({
        where: { id: consultationId, doctorId },
        select: { id: true, status: true, recordSharedAt: true, endedAt: true, slot: { select: { endsAt: true } }, patientId: true, patient: { select: { userId: true } } },
    });
    if (!c) throw new DoctorError(404, 'Not found');
    return c;
}

/** Lab reports for this person from the owning account's lab bookings. */
export function reportsWhere(ownerUserId: string, patientId: string): Prisma.ReportWhereInput {
    return {
        booking: { userId: ownerUserId },
        OR: [
            { vendorCustomerId: patientId },
            // No customer id (older reports, or the webhook left it out): only when every test on the
            // lab booking was for this person, so a family booking's report is never shown to the wrong doctor.
            { vendorCustomerId: '', booking: { items: { some: { patientId }, every: { patientId } } } },
        ],
    };
}

async function logAccess(db: Pick<PrismaClient, 'healthRecordAccess'>, row: { consultationId: string; doctorId: string; patientId: string; action: string; targetId?: string | null; ipAddress?: string | null }) {
    await db.healthRecordAccess.create({ data: { ...row, targetId: row.targetId ?? null, ipAddress: row.ipAddress ?? null } });
}

/**
 * The whole record for the doctor's side panel, or why it is closed. Files are listed without links;
 * each is opened through openSharedFile so every open is logged.
 */
export async function getSharedRecord(doctorId: string, consultationId: string, meta: AccessMeta = {}, deps: ReadDeps = {}) {
    const db = deps.db ?? prisma;
    const now = (deps.now ?? (() => new Date()))();
    const c = await sharedConsultation(db, doctorId, consultationId);
    const w = recordWindow(c, now);
    if (!w.open) return { shared: false as const, reason: w.reason, until: w.until };

    const [reports, past, documents, vitals] = await Promise.all([
        db.report.findMany({
            where: reportsWhere(c.patient.userId, c.patientId),
            orderBy: { generatedAt: 'desc' },
            take: REPORTS,
            select: {
                id: true, isFullReport: true, verifiedAt: true, generatedAt: true, vendorCustomerId: true,
                booking: { select: { slotDate: true, items: { select: { patientId: true, testName: true } } } },
            },
        }),
        db.consultation.findMany({
            where: { patientId: c.patientId, id: { not: c.id }, status: 'COMPLETED' },
            orderBy: { startsAt: 'desc' },
            take: PAST_CONSULTATIONS,
            select: {
                id: true, startsAt: true, type: true,
                doctor: { select: { displayName: true, specialty: { select: { name: true } } } },
                note: { select: { complaints: true, findings: true, diagnosis: true, advice: true, followUpDays: true } },
                prescriptions: { where: { voidedAt: null }, take: 1 },
                attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true } },
            },
        }),
        db.patientDocument.findMany({
            where: { patientId: c.patientId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
        }),
        // P8: BP, sugar and periods, only when the consent the patient gave names them (v2 wording).
        // Covered by the same RECORD log row as the rest.
        db.recordShareConsent.findFirst({ where: { consultationId: c.id, granted: true }, orderBy: { createdAt: 'desc' }, select: { version: true } })
            .then((consent) => (consent && VITALS_SHARE_VERSIONS.includes(consent.version) ? vitalsForRecord(db, c.patientId, now) : null)),
    ]);
    await logAccess(db, { consultationId: c.id, doctorId, patientId: c.patientId, action: 'RECORD', ipAddress: meta.ipAddress });

    const file = (f: { id: string; name: string; mimeType: string; sizeBytes: number; createdAt: Date }) => ({ id: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, uploadedAt: f.createdAt });
    return {
        shared: true as const,
        until: w.until,
        reports: reports.map((r) => {
            const own = r.booking.items.filter((i) => i.patientId === c.patientId);
            return {
                id: r.id,
                label: [...new Set((own.length ? own : r.booking.items).map((i) => i.testName).filter(Boolean))].join(', ') || 'Lab report',
                isFullReport: r.isFullReport,
                date: r.verifiedAt ?? r.generatedAt,
            };
        }),
        consultations: past.map((p) => ({
            id: p.id,
            startsAt: p.startsAt,
            type: p.type,
            doctorName: p.doctor.displayName,
            specialty: p.doctor.specialty.name,
            note: p.note,
            prescription: p.prescriptions[0] ?? null,
            attachments: p.attachments.map(file),
        })),
        documents: documents.map(file),
        vitals,
    };
}

export type SharedFileKind = 'document' | 'attachment' | 'report';

/** Opens one item of the shared record: checks the window again, logs the open, hands a short link. */
export async function openSharedFile(doctorId: string, consultationId: string, kind: SharedFileKind, targetId: string, meta: AccessMeta = {}, deps: ReadDeps = {}) {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    const now = (deps.now ?? (() => new Date()))();
    const c = await sharedConsultation(db, doctorId, consultationId);
    const w = recordWindow(c, now);
    if (!w.open) throw new DoctorError(403, w.reason === 'ENDED' ? 'Access to this health record has ended' : 'The patient has not shared their health record for this consultation');

    const audit = (action: string) => logAccess(db, { consultationId: c.id, doctorId, patientId: c.patientId, action, targetId, ipAddress: meta.ipAddress });
    if (kind === 'report') {
        const r = await db.report.findFirst({ where: { id: targetId, ...reportsWhere(c.patient.userId, c.patientId) }, select: { id: true } });
        if (!r) throw new DoctorError(404, 'Not found');
        await audit('REPORT');
        return { kind, viewToken: createReportAccessToken(r.id, DOCTOR_LINK_SECONDS * 1000) };
    }
    const f = kind === 'document'
        ? await db.patientDocument.findFirst({ where: { id: targetId, patientId: c.patientId } })
        // Same as the listing: this booking's own files, or those of a finished visit.
        : await db.consultationAttachment.findFirst({ where: { id: targetId, consultation: { patientId: c.patientId, OR: [{ id: c.id }, { status: 'COMPLETED' }] } } });
    if (!f) throw new DoctorError(404, 'Not found');
    const url = await storage.signedUrl(f.storageKey, DOCTOR_LINK_SECONDS, f.name);
    await audit(kind === 'document' ? 'DOCUMENT' : 'ATTACHMENT');
    return { kind, name: f.name, mimeType: f.mimeType, url };
}
