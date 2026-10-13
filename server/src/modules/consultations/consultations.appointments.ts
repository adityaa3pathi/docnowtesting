/** Admin view of consultations by IST day. Clinical notes and prescriptions stay out: staff see logistics only. */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';
import { ConsultationStatus } from './consultations.types';

const IST_OFFSET_MS = 330 * 60_000;

export const appointmentsQuery = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    status: z.nativeEnum(ConsultationStatus).optional(),
    doctorId: z.string().uuid('Invalid doctor').optional(),
});

/** Start and end of an IST calendar day, as UTC instants. */
export function istDayRange(date?: string, now = new Date()) {
    const day = date ?? new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS);
    if (Number.isNaN(start.getTime())) throw new DoctorError(400, 'Invalid date');
    return { day, start, end: new Date(start.getTime() + 24 * 3600_000) };
}

const rowSelect = {
    id: true, status: true, type: true, startsAt: true, feePaise: true, platformFeePaise: true,
    patientJoinedAt: true, doctorJoinedAt: true, startedAt: true, endedAt: true, reviewReason: true,
    slot: { select: { endsAt: true } },
    doctor: { select: { id: true, displayName: true, specialty: { select: { name: true } } } },
    patient: { select: { name: true } },
    user: { select: { mobile: true } },
    prescription: { select: { issuedAt: true } },
} satisfies Prisma.ConsultationSelect;

type Row = Prisma.ConsultationGetPayload<{ select: typeof rowSelect }>;

const toRow = ({ prescription, slot, ...c }: Row) => ({ ...c, endsAt: slot.endsAt, prescriptionIssuedAt: prescription?.issuedAt ?? null });

export async function listAppointments(q: z.infer<typeof appointmentsQuery>) {
    const { day, start, end } = istDayRange(q.date);
    const rows = await prisma.consultation.findMany({
        where: {
            startsAt: { gte: start, lt: end },
            status: q.status ?? { notIn: ['PENDING_PAYMENT', 'EXPIRED'] },
            doctorId: q.doctorId,
        },
        select: rowSelect,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 500,
    });
    return { date: day, items: rows.map(toRow) };
}

export async function getAppointment(id: string) {
    const c = await prisma.consultation.findUnique({
        where: { id },
        select: {
            ...rowSelect,
            cancelledBy: true, cancelReason: true, cancelledAt: true, createdAt: true,
            payments: { select: { id: true, status: true, amountPaise: true, razorpayPaymentId: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
            refunds: { select: { id: true, status: true, amountPaise: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        },
    });
    if (!c) throw new DoctorError(404, 'Not found');
    const { payments, refunds, cancelledBy, cancelReason, cancelledAt, createdAt, ...row } = c;
    return { ...toRow(row), payments, refunds, cancelledBy, cancelReason, cancelledAt, createdAt };
}
