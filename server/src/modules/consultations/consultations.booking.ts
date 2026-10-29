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
import { DOCTOR_LATE_AFTER_MS, noShowDeadlines } from './consultations.room';
import { DoctorError } from './doctors.status';
import { accessFor, familyWhere, isSelf, userMobile } from './consultations.family';

export const MAX_OPEN_HOLDS_PER_USER = 3;
export const MAX_OPEN_HOLDS_PER_DOCTOR = 1;

export type BookingDeps = { db?: PrismaClient; razorpay?: ConsultRazorpay; now?: () => Date };
export type BookingInput = {
    userId: string;
    patientId: string;
    slotId: string;
    idempotencyKey: string;
    /** Family bookings: the booker will co-join the call to assist. */
    isCaregiverJoined?: boolean;
    /** DocNow lab reports (from the booker's own lab bookings) to share with the doctor. */
    attachedReportIds?: string[];
};

export const MAX_ATTACHED_REPORTS = 5;
/** Base of the zero-login web room link sent to family members. */
export const guestJoinUrl = (token: string) => `${(process.env.GUEST_CALL_BASE_URL || 'https://docnow.in/call').replace(/\/+$/, '')}/${token}`;

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

    const patient = await db.patient.findFirst({ where: { id: input.patientId, userId: input.userId }, select: { id: true, relation: true } });
    if (!patient) throw new DoctorError(404, 'Not found');
    const forFamily = !isSelf(patient.relation);

    // Only reports from the booker's own lab bookings can be shared, and each at most once.
    const reportIds = [...new Set(input.attachedReportIds ?? [])];
    if (reportIds.length > MAX_ATTACHED_REPORTS) throw new DoctorError(400, `Attach at most ${MAX_ATTACHED_REPORTS} reports`);
    if (reportIds.length) {
        const owned = await db.report.count({ where: { id: { in: reportIds }, booking: { userId: input.userId } } });
        if (owned !== reportIds.length) throw new DoctorError(404, 'Report not found');
    }

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
                    guestToken: randomUUID(),
                    isCaregiverJoined: forFamily && (input.isCaregiverJoined ?? true),
                    ...(reportIds.length ? { attachedReports: { create: reportIds.map((reportId) => ({ reportId })) } } : {}),
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
    doctor: { select: { displayName: true, photoUrl: true, qualification: true, specialty: { select: { name: true } } } },
    patient: { select: { name: true, relation: true, phone: true, linkedUserId: true, linkDeclinedAt: true } },
    user: { select: { name: true } },
    slot: { select: { endsAt: true } },
    payments: { orderBy: { createdAt: 'desc' as const } },
    refunds: { orderBy: { createdAt: 'desc' as const } },
    prescriptions: { where: { voidedAt: null }, select: { id: true } },
    note: { select: { id: true, advice: true } },
} satisfies Prisma.ConsultationInclude;

type BookingRow = Prisma.ConsultationGetPayload<{ include: typeof viewInclude }>;

/** What the patient screens need: the booking, who and when, and where payment and refund stand. */
function toView(c: BookingRow) {
    const live = c.refunds.filter((r) => !(r.status === 'FAILED' && r.failureConfirmed));
    const rxStatus = c.prescriptions.length > 0
        ? 'ISSUED'
        : c.note !== null
        ? 'DRAFTING'
        : (c.status === 'COMPLETED' ? 'NOT_REQUIRED' : 'PENDING');

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
        hasPrescription: c.prescriptions.length > 0,
        prescriptionId: c.prescriptions[0]?.id ?? null,
        rxStatus,
        type: c.type,
        // Waiting room: who the doctor is, whether they are in, and when the delay options and the
        // automatic doctor no-show refund begin (both from the rules saved with the booking).
        doctorPhotoUrl: c.doctor.photoUrl,
        doctorQualification: c.doctor.qualification,
        doctorJoined: c.doctorJoinedAt !== null,
        doctorLateAt: new Date(c.startsAt.getTime() + DOCTOR_LATE_AFTER_MS),
        doctorNoShowAt: noShowDeadlines(c).doctorBy,
        cancelReason: c.cancelReason,
        isCaregiverJoined: c.isCaregiverJoined,
        isBookedForYou: false,
        // Family bookings: the link the booker can forward, and whether the family member has
        // accepted the booking on their own phone (false + declined means the number may be wrong).
        ...(isSelf(c.patient.relation) ? {} : {
            guestToken: c.guestToken,
            guestJoinUrl: c.guestToken ? guestJoinUrl(c.guestToken) : null,
            familyPhone: c.patient.phone,
            familyLinked: c.patient.linkedUserId !== null,
            familyDeclined: c.patient.linkDeclinedAt !== null,
        }),
    };
}

/**
 * The family member's view: the visit, never the payment. Before they accept, it is cut down to
 * doctor and time (plus who booked), so a wrong number reveals nothing clinical.
 */
function familyView(c: BookingRow, linked: boolean) {
    const base = toView(c);
    const shared = {
        consultationId: base.consultationId,
        status: base.status,
        startsAt: base.startsAt,
        endsAt: base.endsAt,
        type: base.type,
        doctorId: base.doctorId,
        doctorName: base.doctorName,
        doctorPhotoUrl: base.doctorPhotoUrl,
        doctorQualification: base.doctorQualification,
        specialty: base.specialty,
        patientId: base.patientId,
        patientName: base.patientName,
        isBookedForYou: true,
        bookedBy: { name: c.user.name || 'Your family member', relation: c.patient.relation },
        familyAccess: linked ? ('linked' as const) : ('pending' as const),
        // Payment belongs to the booker; the family member never pays, cancels or sees a refund.
        razorpayOrderId: null,
        amountPaise: 0,
        currency: base.currency,
        keyId: null,
        holdExpiresAt: base.holdExpiresAt,
        paymentCaptured: base.paymentCaptured,
        underStaffCheck: false,
        refundPaise: 0,
        refundStatus: null,
    };
    if (!linked) return shared;
    return {
        ...shared,
        hasPrescription: base.hasPrescription,
        prescriptionId: base.prescriptionId,
        rxStatus: base.rxStatus,
        doctorJoined: base.doctorJoined,
        doctorLateAt: base.doctorLateAt,
        doctorNoShowAt: base.doctorNoShowAt,
        cancelReason: base.cancelReason,
        isCaregiverJoined: base.isCaregiverJoined,
    };
}

// Family members see paid bookings only; holds and expired attempts are the booker's business.
const FAMILY_VISIBLE: Prisma.ConsultationWhereInput = { status: { notIn: ['PENDING_PAYMENT', 'EXPIRED'] } };

export async function getBooking(userId: string, consultationId: string, db: PrismaClient = prisma) {
    const c = await db.consultation.findFirst({ where: { id: consultationId }, include: viewInclude });
    if (!c) throw new DoctorError(404, 'Not found');
    const access = accessFor(c, userId, c.userId === userId ? null : await userMobile(db, userId));
    if (!access) throw new DoctorError(404, 'Not found');
    if (access.kind === 'booker') return toView(c);
    if (c.status === 'PENDING_PAYMENT' || c.status === 'EXPIRED') throw new DoctorError(404, 'Not found');
    return familyView(c, access.kind === 'family');
}

/** The booker's own consultations plus those booked for them by family, newest first. */
export async function listBookings(userId: string, db: PrismaClient = prisma, limit = 50) {
    const mobile = await userMobile(db, userId);
    const [own, family] = await Promise.all([
        db.consultation.findMany({ where: { userId }, include: viewInclude, orderBy: { createdAt: 'desc' }, take: limit }),
        mobile
            ? db.consultation.findMany({ where: { AND: [familyWhere(userId, mobile), FAMILY_VISIBLE] }, include: viewInclude, orderBy: { createdAt: 'desc' }, take: limit })
            : Promise.resolve([] as BookingRow[]),
    ]);
    return [
        ...own.map((c) => ({ at: c.createdAt.getTime(), view: toView(c) as ReturnType<typeof toView> | ReturnType<typeof familyView> })),
        ...family.map((c) => ({ at: c.createdAt.getTime(), view: familyView(c, c.patient.linkedUserId === userId) })),
    ]
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map((r) => r.view);
}
