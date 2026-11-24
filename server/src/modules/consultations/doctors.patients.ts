/**
 * The doctor's "Patients" screen (scope doc screen 47 area): everyone this doctor has seen or is
 * booked to see, newest visit first, and per patient only this doctor's own visits (their notes are
 * their own medical record). A patient's whole DocNow record stays behind the P7 sharing rules, on
 * the booking's Health record panel; nothing here widens it. No contact details.
 */
import { z } from 'zod';
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';
import type { ConsultationStatus } from './consultations.types';

/** A booking that makes someone this doctor's patient: paid, and not called off before the visit. */
export const SEEN: ConsultationStatus[] = ['CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW_PATIENT'];

export const patientListQuery = z.object({
    q: z.string().trim().max(80, 'Search for at most 80 characters').optional().transform((v) => v || undefined),
    page: z.coerce.number().int().min(1).max(1000).optional().default(1),
});
const PAGE = 30;

export async function listDoctorPatients(doctorId: string, q: z.infer<typeof patientListQuery>) {
    const where = {
        doctorId,
        status: { in: SEEN },
        ...(q.q ? { patient: { name: { contains: q.q, mode: 'insensitive' as const } } } : {}),
    };
    const groups = await prisma.consultation.groupBy({
        by: ['patientId'],
        where,
        _count: { _all: true },
        _max: { startsAt: true },
        orderBy: [{ _max: { startsAt: 'desc' } }, { patientId: 'asc' }],
        skip: (q.page - 1) * PAGE,
        take: PAGE + 1,
    });
    const page = groups.slice(0, PAGE);
    const people = await prisma.patient.findMany({
        where: { id: { in: page.map((g) => g.patientId) } },
        select: { id: true, name: true, age: true, gender: true },
    });
    return {
        items: page.map((g) => {
            const p = people.find((x) => x.id === g.patientId)!;
            return { id: p.id, name: p.name, age: p.age, gender: p.gender, visits: g._count._all, lastVisitAt: g._max.startsAt };
        }),
        nextPage: groups.length > PAGE ? q.page + 1 : null,
    };
}

/** One patient: this doctor's own visits with them. Someone they never saw reads as missing. */
export async function getDoctorPatient(doctorId: string, patientId: string) {
    const visits = await prisma.consultation.findMany({
        where: { doctorId, patientId, status: { in: SEEN } },
        orderBy: { startsAt: 'desc' },
        select: {
            id: true, startsAt: true, status: true, type: true,
            slot: { select: { endsAt: true } },
            note: { select: { complaints: true, diagnosis: true, followUpDays: true } },
            prescriptions: { where: { voidedAt: null }, select: { id: true, version: true, issuedAt: true } },
        },
    });
    if (!visits.length) throw new DoctorError(404, 'Not found');
    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { id: true, name: true, age: true, gender: true } });
    return {
        patient: p,
        visits: visits.map((v) => ({
            id: v.id, startsAt: v.startsAt, endsAt: v.slot.endsAt, status: v.status, type: v.type,
            complaints: v.note?.complaints ?? null, diagnosis: v.note?.diagnosis ?? null, followUpDays: v.note?.followUpDays ?? null,
            prescription: v.prescriptions[0] ?? null,
        })),
    };
}
