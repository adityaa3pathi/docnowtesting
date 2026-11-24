/**
 * Super admin: one person's whole DocNow health record (sheet row 30), for support, disputes and
 * medico-legal requests. Super admins only (managers never). Every view and every file opened writes
 * an AdminAuditLog row, so who looked at whose record is always on file.
 *
 * Shows: health details, every consultation (doctor, status, notes, current prescription, attached
 * files, payments and refunds, sharing state), DocNow lab reports, vault files, the patient's
 * sharing consents, the doctors' access log, and vitals (P8: the last year of readings, recent periods).
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { createReportAccessToken } from '../../services/reportAccess';
import { DoctorError } from './doctors.status';
import { s3AttachmentStorage, type AttachmentStorage } from './consultations.attachments';
import { DOCTOR_LINK_SECONDS, reportsWhere, type SharedFileKind } from './consultations.records';
import { vitalsForRecord } from './consultations.vitals';

export type AdminActor = { adminId: string; adminName: string; ipAddress?: string | null };
type Deps = { db?: PrismaClient; storage?: AttachmentStorage };

const RECENT = 100;

async function audit(db: Pick<PrismaClient, 'adminAuditLog'>, actor: AdminActor, action: string, patientId: string, detail?: Record<string, string>) {
    await db.adminAuditLog.create({
        data: {
            adminId: actor.adminId,
            adminName: actor.adminName,
            action,
            entity: 'Patient',
            targetId: patientId,
            ...(detail ? { newValue: detail } : {}),
            ipAddress: actor.ipAddress ?? null,
        },
    });
}

/** The people (self and family) on one account, to pick whose record to open. Names only: not logged. */
export async function accountPeople(userId: string, db: PrismaClient = prisma) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new DoctorError(404, 'Not found');
    const people = await db.patient.findMany({
        where: { userId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, relation: true, age: true, gender: true, _count: { select: { consultations: true, documents: true } } },
    });
    return people.map(({ _count, ...p }) => ({ ...p, consultations: _count.consultations, documents: _count.documents }));
}

const file = (f: { id: string; name: string; mimeType: string; sizeBytes: number; createdAt: Date }) => ({ id: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, uploadedAt: f.createdAt });

export async function getPatientRecord(patientId: string, actor: AdminActor, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const person = await db.patient.findUnique({
        where: { id: patientId },
        select: {
            id: true, name: true, relation: true, age: true, gender: true, dob: true, bloodGroup: true,
            allergies: true, allergiesConfirmedAt: true, chronicConditions: true, currentMedications: true,
            user: { select: { id: true, name: true, mobile: true, status: true, deletedAt: true } },
        },
    });
    if (!person) throw new DoctorError(404, 'Not found');

    const [consultations, reports, documents, consents, access, vitals, totals] = await Promise.all([
        db.consultation.findMany({
            where: { patientId },
            orderBy: { startsAt: 'desc' },
            take: RECENT,
            select: {
                id: true, startsAt: true, status: true, type: true, feePaise: true, walletPaise: true, discountPaise: true,
                cancelReason: true, cancelledBy: true, endedAt: true, recordSharedAt: true, createdAt: true,
                doctor: { select: { id: true, displayName: true, specialty: { select: { name: true } } } },
                note: { select: { complaints: true, findings: true, diagnosis: true, advice: true, followUpDays: true } },
                prescriptions: { orderBy: { version: 'desc' } },
                attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true } },
                payments: { orderBy: { createdAt: 'asc' }, select: { id: true, source: true, amountPaise: true, status: true, razorpayPaymentId: true, capturedAt: true } },
                refunds: { orderBy: { createdAt: 'asc' }, select: { id: true, paymentId: true, reason: true, amountPaise: true, status: true, createdAt: true } },
                promoCode: { select: { code: true } },
            },
        }),
        db.report.findMany({
            where: reportsWhere(person.user.id, patientId),
            orderBy: { generatedAt: 'desc' },
            take: RECENT,
            select: { id: true, isFullReport: true, verifiedAt: true, generatedAt: true, fetchStatus: true, bookingId: true, booking: { select: { items: { select: { patientId: true, testName: true } } } } },
        }),
        db.patientDocument.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true } }),
        db.recordShareConsent.findMany({
            where: { consultation: { patientId } },
            orderBy: { createdAt: 'desc' },
            take: RECENT,
            select: { id: true, consultationId: true, granted: true, version: true, channel: true, userId: true, createdAt: true },
        }),
        db.healthRecordAccess.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: RECENT }),
        vitalsForRecord(db, patientId, new Date(), { days: 365, readings: RECENT, periods: 24 }),
        // The lists stop at the latest RECENT; the page says "latest 100 of N" when there are more.
        Promise.all([
            db.consultation.count({ where: { patientId } }),
            db.report.count({ where: reportsWhere(person.user.id, patientId) }),
            db.recordShareConsent.count({ where: { consultation: { patientId } } }),
            db.healthRecordAccess.count({ where: { patientId } }),
        ]).then(([c, r, s, a]) => ({ consultations: c, reports: r, consents: s, accessLog: a })),
    ]);
    const doctorIds = [...new Set(access.map((a) => a.doctorId))];
    const doctors = doctorIds.length ? await db.doctorProfile.findMany({ where: { id: { in: doctorIds } }, select: { id: true, displayName: true } }) : [];
    await audit(db, actor, 'PATIENT_RECORD_VIEW', patientId);

    const { user, ...health } = person;
    return {
        totals,
        listLimit: RECENT,
        person: health,
        account: { id: user.id, name: user.name, mobile: user.deletedAt ? null : user.mobile, status: user.status, deleted: !!user.deletedAt },
        consultations: consultations.map(({ prescriptions, attachments, promoCode, ...c }) => ({
            ...c,
            promoCode: promoCode?.code ?? null,
            prescription: prescriptions.find((p) => !p.voidedAt) ?? null,
            voidedPrescriptions: prescriptions.filter((p) => p.voidedAt).map((p) => ({ id: p.id, version: p.version, issuedAt: p.issuedAt, voidedAt: p.voidedAt, voidReason: p.voidReason })),
            attachments: attachments.map(file),
        })),
        reports: reports.map((r) => {
            const own = r.booking.items.filter((i) => i.patientId === patientId);
            return {
                id: r.id,
                bookingId: r.bookingId,
                label: [...new Set((own.length ? own : r.booking.items).map((i) => i.testName).filter(Boolean))].join(', ') || 'Lab report',
                isFullReport: r.isFullReport,
                fetchStatus: r.fetchStatus,
                date: r.verifiedAt ?? r.generatedAt,
            };
        }),
        documents: documents.map(file),
        vitals,
        consents,
        accessLog: access.map((a) => ({
            id: a.id, at: a.createdAt, action: a.action, targetId: a.targetId, consultationId: a.consultationId,
            doctorName: doctors.find((d) => d.id === a.doctorId)?.displayName ?? 'Removed doctor',
        })),
    };
}

/** Opens one file or report of the person's record for the super admin; logged like the view. */
export async function openPatientFile(patientId: string, kind: SharedFileKind, targetId: string, actor: AdminActor, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    const person = await db.patient.findUnique({ where: { id: patientId }, select: { userId: true } });
    if (!person) throw new DoctorError(404, 'Not found');
    const detail = { kind, targetId };
    if (kind === 'report') {
        const r = await db.report.findFirst({ where: { id: targetId, ...reportsWhere(person.userId, patientId) }, select: { id: true } });
        if (!r) throw new DoctorError(404, 'Not found');
        await audit(db, actor, 'PATIENT_FILE_VIEW', patientId, detail);
        return { kind, viewToken: createReportAccessToken(r.id, DOCTOR_LINK_SECONDS * 1000) };
    }
    const f = kind === 'document'
        ? await db.patientDocument.findFirst({ where: { id: targetId, patientId } })
        : await db.consultationAttachment.findFirst({ where: { id: targetId, consultation: { patientId } } });
    if (!f) throw new DoctorError(404, 'Not found');
    const url = await storage.signedUrl(f.storageKey, DOCTOR_LINK_SECONDS, f.name);
    await audit(db, actor, 'PATIENT_FILE_VIEW', patientId, detail);
    return { kind, name: f.name, mimeType: f.mimeType, url };
}
