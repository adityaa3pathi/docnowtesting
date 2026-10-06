/**
 * Booking: hold a slot, copy the rules, and create the Razorpay order.
 * The slot is held in one transaction. Razorpay is called outside it, and a failure releases the hold.
 */
import { createHash, randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { feeFromBps, toPaise } from './consultations.money';
import { getActivePolicy } from './consultations.policy.service';
import { ConsultRazorpay, normalizeRazorpayError, realConsultRazorpay } from './consultations.razorpay';
import { expireHold, holdSlot } from './consultations.transitions';
import { DoctorError } from './doctors.status';

export const MAX_OPEN_HOLDS_PER_USER = 3;
export const MAX_OPEN_HOLDS_PER_DOCTOR = 1;

export type BookingDeps = { db?: PrismaClient; razorpay?: ConsultRazorpay; now?: () => Date };
export type BookingInput = { userId: string; patientId: string; slotId: string; idempotencyKey: string };

const SLOT_TAKEN = 'Slot is no longer available';

function response(c: { id: string; holdExpiresAt: Date; status: string; feePaise: number }, orderId: string | undefined) {
    return {
        consultationId: c.id,
        status: c.status,
        razorpayOrderId: orderId ?? null,
        amountPaise: c.feePaise,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID ?? null,
        holdExpiresAt: c.holdExpiresAt,
    };
}

async function existingBooking(db: PrismaClient, input: BookingInput, requestHash: string) {
    const found = await db.consultation.findUnique({
        where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
        include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!found) return null;
    if (found.requestHash !== requestHash) throw new DoctorError(409, 'This idempotency key was used for a different request');
    const orderId = found.payments[0]?.razorpayOrderId;
    if (found.status !== 'PENDING_PAYMENT') throw new DoctorError(409, 'This booking has ended. Start a new booking with a new idempotency key');
    if (!orderId) throw new DoctorError(409, 'This booking is still being set up. Try again in a moment');
    return response(found, orderId);
}

/** Expires a lapsed hold on a booked slot, but only after Razorpay confirms nothing was paid. */
async function releaseStaleHold(db: PrismaClient, razorpay: ConsultRazorpay, slotId: string, now: Date) {
    const held = await db.consultation.findFirst({
        where: { slotId, status: 'PENDING_PAYMENT' },
        include: { payments: true },
    });
    if (!held || held.holdExpiresAt > now) throw new DoctorError(409, SLOT_TAKEN);
    try {
        for (const orderId of new Set(held.payments.map((p) => p.razorpayOrderId))) {
            const paid = await razorpay.fetchOrderPayments(orderId);
            if (paid.some((p) => p.status === 'captured' || p.status === 'authorized')) throw new DoctorError(409, SLOT_TAKEN);
        }
    } catch (e) {
        if (e instanceof DoctorError) throw e;
        normalizeRazorpayError(e);
        throw new DoctorError(409, SLOT_TAKEN);
    }
    await db.$transaction((tx) => expireHold(tx, held.id));
}

export async function createBooking(input: BookingInput, deps: BookingDeps = {}) {
    const db = deps.db ?? prisma;
    const razorpay = deps.razorpay ?? realConsultRazorpay();
    const now = (deps.now ?? (() => new Date()))();
    const requestHash = createHash('sha256').update(`${input.slotId}|${input.patientId}`).digest('hex');

    const repeated = await existingBooking(db, input, requestHash);
    if (repeated) return repeated;

    const patient = await db.patient.findFirst({ where: { id: input.patientId, userId: input.userId }, select: { id: true } });
    if (!patient) throw new DoctorError(404, 'Not found');

    const slot = await db.slot.findUnique({ where: { id: input.slotId }, include: { doctor: true } });
    if (!slot || slot.doctor.status !== 'APPROVED') throw new DoctorError(404, 'Slot not available');

    const { rules, id: policyId } = await getActivePolicy(db);
    if (slot.startsAt.getTime() < now.getTime() + rules.minLeadMinutes * 60_000) throw new DoctorError(400, 'This slot starts too soon to book');

    const open = await db.consultation.findMany({
        where: { userId: input.userId, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        select: { doctorId: true },
    });
    if (open.length >= MAX_OPEN_HOLDS_PER_USER) throw new DoctorError(429, 'Too many unpaid bookings. Finish or wait for them to expire');
    if (open.filter((o) => o.doctorId === slot.doctorId).length >= MAX_OPEN_HOLDS_PER_DOCTOR) {
        throw new DoctorError(429, 'You already have an unpaid booking with this doctor');
    }

    if (slot.status === 'BLOCKED') throw new DoctorError(409, SLOT_TAKEN);
    if (slot.status === 'BOOKED') await releaseStaleHold(db, razorpay, slot.id, now);

    const feePaise = toPaise(slot.doctor.consultationFee);
    if (feePaise <= 0) throw new DoctorError(400, 'This doctor has no fee set');
    const holdExpiresAt = new Date(Math.min(now.getTime() + rules.holdMinutes * 60_000, slot.startsAt.getTime() - rules.minLeadMinutes * 60_000));
    if (holdExpiresAt <= now) throw new DoctorError(400, 'This slot starts too soon to book');

    let consultation;
    try {
        consultation = await db.$transaction(async (tx) => {
            if (!(await holdSlot(tx, slot.id))) throw new DoctorError(409, SLOT_TAKEN);
            return tx.consultation.create({
                data: {
                    userId: input.userId,
                    patientId: patient.id,
                    doctorId: slot.doctorId,
                    slotId: slot.id,
                    startsAt: slot.startsAt,
                    feePaise,
                    platformFeePaise: feeFromBps(feePaise, rules.platformFeeBps),
                    policyId,
                    policySnapshot: rules as unknown as Prisma.InputJsonValue,
                    holdExpiresAt,
                    idempotencyKey: input.idempotencyKey,
                    requestHash,
                    orderReceipt: `c_${randomUUID().replace(/-/g, '')}`,
                },
            });
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const again = await existingBooking(db, input, requestHash);
            if (again) return again;
            throw new DoctorError(409, SLOT_TAKEN);
        }
        throw e;
    }

    let orderId: string;
    try {
        const order = await razorpay.createOrder({
            amountPaise: feePaise,
            receipt: consultation.orderReceipt,
            notes: { kind: 'consult', consultationId: consultation.id },
        });
        orderId = order.id;
    } catch (e) {
        const err = normalizeRazorpayError(e);
        logAlert('consult_order_creation_failed', { consultationId: consultation.id, kind: err.kind, status: err.status });
        await db.$transaction((tx) => expireHold(tx, consultation.id));
        throw new DoctorError(502, 'Payment service unavailable. Please try again');
    }
    await db.consultationPayment.create({ data: { consultationId: consultation.id, razorpayOrderId: orderId, amountPaise: feePaise } });
    return response(consultation, orderId);
}

const viewInclude = {
    doctor: { select: { displayName: true, specialty: { select: { name: true } } } },
    patient: { select: { name: true } },
    slot: { select: { endsAt: true } },
    payments: { orderBy: { createdAt: 'desc' as const } },
    refunds: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.ConsultationInclude;

type BookingRow = Prisma.ConsultationGetPayload<{ include: typeof viewInclude }>;

/** What the patient screens need: the booking, who and when, and where payment and refund stand. */
function toView(c: BookingRow) {
    const live = c.refunds.filter((r) => !(r.status === 'FAILED' && r.failureConfirmed));
    return {
        ...response(c, c.payments[0]?.razorpayOrderId),
        startsAt: c.startsAt,
        endsAt: c.slot.endsAt,
        doctorId: c.doctorId,
        doctorName: c.doctor.displayName,
        specialty: c.doctor.specialty.name,
        patientId: c.patientId,
        patientName: c.patient.name,
        paymentCaptured: c.payments.some((p) => p.status === 'CAPTURED'),
        underStaffCheck: c.reviewReason !== null,
        refundPaise: live.reduce((sum, r) => sum + r.amountPaise, 0),
        refundStatus: c.refunds[0]?.status ?? null,
    };
}

export async function getBooking(userId: string, consultationId: string, db: PrismaClient = prisma) {
    const c = await db.consultation.findFirst({ where: { id: consultationId, userId }, include: viewInclude });
    if (!c) throw new DoctorError(404, 'Not found');
    return toView(c);
}

export async function listBookings(userId: string, db: PrismaClient = prisma, limit = 50) {
    const rows = await db.consultation.findMany({ where: { userId }, include: viewInclude, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(toView);
}
