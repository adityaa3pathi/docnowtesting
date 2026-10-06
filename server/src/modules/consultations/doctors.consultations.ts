// The doctor's own consultation list. A fixed select keeps payment, refund and patient
// contact details out of the response.
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';
import type { ConsultationStatus } from './consultations.types';

export const LIVE: ConsultationStatus[] = ['CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS'];
const ENDED: ConsultationStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR', 'REFUNDED'];

export const doctorListQuery = z.object({
    scope: z.enum(['upcoming', 'past'], { message: 'Scope must be upcoming or past' }),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).optional().default(30),
});

export const encodeCursor = (startsAt: Date, id: string) => Buffer.from(`${startsAt.toISOString()}|${id}`).toString('base64url');

function decodeCursor(cursor: string) {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const startsAt = new Date(iso ?? '');
    if (!id || Number.isNaN(startsAt.getTime())) throw new DoctorError(400, 'Invalid cursor');
    return { startsAt, id };
}

export async function listDoctorConsultations(doctorId: string, q: z.infer<typeof doctorListQuery>) {
    const limit = Math.min(q.limit, 50);
    const upcoming = q.scope === 'upcoming';
    const now = new Date();
    const base: Prisma.ConsultationWhereInput = upcoming
        ? { status: { in: LIVE }, slot: { endsAt: { gt: now } } }
        : { OR: [{ status: { in: ENDED } }, { status: { in: LIVE }, slot: { endsAt: { lte: now } } }] };
    const conds: Prisma.ConsultationWhereInput[] = [{ doctorId }, base];
    if (q.cursor) {
        const c = decodeCursor(q.cursor);
        const op = upcoming ? 'gt' : 'lt';
        conds.push({ OR: [{ startsAt: { [op]: c.startsAt } }, { startsAt: c.startsAt, id: { [op]: c.id } }] });
    }
    const dir = upcoming ? 'asc' : 'desc';
    const rows = await prisma.consultation.findMany({
        where: { AND: conds },
        select: { id: true, startsAt: true, status: true, type: true, slot: { select: { endsAt: true } }, patient: { select: { name: true } } },
        orderBy: [{ startsAt: dir }, { id: dir }],
        take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
        items: page.map((r) => ({ id: r.id, startsAt: r.startsAt, endsAt: r.slot.endsAt, status: r.status, type: r.type, patientName: r.patient.name })),
        nextCursor: rows.length > limit && last ? encodeCursor(last.startsAt, last.id) : null,
    };
}
