/**
 * Doctor notes and prescriptions. Notes stay editable until the first prescription is issued. A
 * prescription's content never changes; a correction voids it and issues the next version.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { addCatalogItemToCart } from '../../services/cartService';
import { DoctorError } from './doctors.status';
import type { ConsultationStatus } from './consultations.types';

const WRITABLE: ConsultationStatus[] = ['IN_PROGRESS', 'COMPLETED'];

const text = (max: number) => z.string().trim().max(max).optional();

export const noteSchema = z.object({
    complaints: text(2000),
    findings: text(2000),
    diagnosis: text(1000),
    advice: text(2000),
    followUpDays: z.number().int().min(1).max(365).nullable().optional(),
});

const medicineSchema = z.object({
    name: z.string().trim().min(1, 'Medicine name is required').max(120),
    dose: z.string().trim().max(60).default(''),
    frequency: z.string().trim().max(60).default(''),
    duration: z.string().trim().max(60).default(''),
    instructions: z.string().trim().max(200).default(''),
});

export const prescriptionSchema = z.object({
    medicines: z.array(medicineSchema).max(20).default([]),
    testCodes: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    advice: text(2000),
}).refine((p) => p.medicines.length > 0 || p.testCodes.length > 0 || !!p.advice, {
    message: 'Add at least one medicine, test or advice',
});

export type RecommendedTest = { code: string; name: string };

export const reissueSchema = z.object({
    reason: z.string().trim().min(5, 'Say briefly why the prescription is being corrected').max(300),
    prescription: prescriptionSchema,
});

const REISSUE_WINDOW_MS = 7 * 24 * 3_600_000;
const current = { where: { voidedAt: null } } as const;

async function doctorConsultation(doctorId: string, consultationId: string) {
    const c = await prisma.consultation.findFirst({
        where: { id: consultationId, doctorId },
        select: { id: true, status: true, startsAt: true, prescriptions: { ...current, select: { id: true, version: true } } },
    });
    if (!c) throw new DoctorError(404, 'Not found');
    if (!WRITABLE.includes(c.status)) throw new DoctorError(409, 'Notes open once the consultation has started');
    return { ...c, current: c.prescriptions[0] ?? null };
}

export async function getDoctorRecord(doctorId: string, consultationId: string) {
    const c = await prisma.consultation.findFirst({
        where: { id: consultationId, doctorId },
        select: {
            id: true, status: true, type: true, startsAt: true, patientJoinedAt: true, doctorJoinedAt: true, slot: { select: { endsAt: true } },
            patient: { select: { name: true, age: true, gender: true } },
            note: true, prescriptions: { orderBy: { version: 'desc' } },
        },
    });
    if (!c) throw new DoctorError(404, 'Not found');
    const { prescriptions, ...rest } = c;
    const voided = prescriptions.filter((p) => p.voidedAt);
    return {
        ...rest,
        prescription: prescriptions.find((p) => !p.voidedAt) ?? null,
        previousVersions: voided.map((p) => ({ id: p.id, version: p.version, issuedAt: p.issuedAt, voidedAt: p.voidedAt, voidReason: p.voidReason })),
    };
}

export async function saveNotes(doctorId: string, consultationId: string, data: z.infer<typeof noteSchema>) {
    const c = await doctorConsultation(doctorId, consultationId);
    if (c.current) throw new DoctorError(409, 'Notes are locked once the prescription is issued');
    return prisma.consultationNote.upsert({
        where: { consultationId },
        update: data,
        create: { consultationId, ...data },
    });
}

/** Checks the tests against the catalog and freezes doctor and patient details as they are now. */
async function buildContent(consultationId: string, input: z.infer<typeof prescriptionSchema>) {
    const codes = [...new Set(input.testCodes)];
    const items = await prisma.catalogItem.findMany({
        where: { partnerCode: { in: codes }, isEnabled: true },
        select: { partnerCode: true, name: true },
    });
    const missing = codes.find((code) => !items.some((i) => i.partnerCode === code));
    if (missing) throw new DoctorError(400, `Unknown or unavailable test: ${missing}`);
    const tests: RecommendedTest[] = codes.map((code) => ({ code, name: items.find((i) => i.partnerCode === code)!.name }));

    const c = await prisma.consultation.findUniqueOrThrow({
        where: { id: consultationId },
        select: {
            doctor: { select: { displayName: true, qualification: true, registrationNumber: true, registrationCouncil: true, specialty: { select: { name: true } } } },
            patient: { select: { name: true, age: true, gender: true } },
        },
    });
    return {
        consultationId,
        medicines: input.medicines,
        recommendedTests: tests,
        advice: input.advice,
        doctorSnapshot: { ...c.doctor, specialty: c.doctor.specialty.name },
        patientSnapshot: c.patient,
    };
}

const alreadyIssued = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function issuePrescription(doctorId: string, consultationId: string, input: z.infer<typeof prescriptionSchema>) {
    const c = await doctorConsultation(doctorId, consultationId);
    if (c.current) throw new DoctorError(409, 'A prescription has already been issued');
    const data = await buildContent(consultationId, input);
    try {
        return await prisma.prescription.create({ data });
    } catch (e) {
        if (alreadyIssued(e)) throw new DoctorError(409, 'A prescription has already been issued');
        throw e;
    }
}

/** Voids the current version and issues the next one, in one transaction, within 7 days of the visit. */
export async function reissuePrescription(doctorId: string, consultationId: string, input: z.infer<typeof reissueSchema>, now = new Date()) {
    const c = await doctorConsultation(doctorId, consultationId);
    if (!c.current) throw new DoctorError(409, 'There is no prescription to correct');
    if (now.getTime() - c.startsAt.getTime() > REISSUE_WINDOW_MS) {
        throw new DoctorError(409, 'Prescriptions can be corrected only within 7 days of the consultation');
    }
    const data = await buildContent(consultationId, input.prescription);
    try {
        return await prisma.$transaction(async (tx) => {
            const voided = await tx.prescription.updateMany({
                where: { id: c.current!.id, voidedAt: null },
                data: { voidedAt: now, voidReason: input.reason },
            });
            if (voided.count !== 1) throw new DoctorError(409, 'The prescription changed meanwhile; reload and try again');
            return tx.prescription.create({ data: { ...data, version: c.current!.version + 1 } });
        });
    } catch (e) {
        if (alreadyIssued(e)) throw new DoctorError(409, 'The prescription changed meanwhile; reload and try again');
        throw e;
    }
}

/** The patient's view: the prescription for their own consultation, or 404. */
export async function getPatientPrescription(userId: string, consultationId: string) {
    const p = await prisma.prescription.findFirst({
        where: { consultationId, voidedAt: null, consultation: { userId } },
        include: { consultation: { select: { startsAt: true, patientId: true } } },
    });
    if (!p) throw new DoctorError(404, 'No prescription yet');
    return p;
}

/** Adds each recommended test for the consultation's patient, skipping ones already in the cart. */
export async function addRecommendedTestsToCart(userId: string, consultationId: string) {
    const p = await getPatientPrescription(userId, consultationId);
    const patientId = p.consultation.patientId;
    const tests = p.recommendedTests as RecommendedTest[];
    const inCart = await prisma.cartItem.findMany({
        where: { cart: { userId }, patientId, testCode: { in: tests.map((t) => t.code) } },
        select: { testCode: true },
    });
    const added: string[] = [];
    const skipped: { code: string; reason: string }[] = [];
    for (const t of tests) {
        if (inCart.some((i) => i.testCode === t.code)) {
            skipped.push({ code: t.code, reason: 'Already in cart' });
            continue;
        }
        const r = await addCatalogItemToCart(userId, t.code, patientId);
        if (r.ok) added.push(t.code);
        else skipped.push({ code: t.code, reason: r.error });
    }
    return { added, skipped };
}
