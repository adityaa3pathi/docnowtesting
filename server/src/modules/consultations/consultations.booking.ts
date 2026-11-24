/**
 * Booking: hold a slot, copy the rules, take any wallet part, and create the Razorpay order for the rest.
 * The slot and the wallet part are held in one transaction. Razorpay is called outside it, and a
 * failure releases both. A booking the wallet pays in full confirms in that transaction, without Razorpay.
 */
import { createHash, randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { cardDuePaise, feeFromBps, toPaise, walletShare } from './consultations.money';
import { getActivePolicy } from './consultations.policy.service';
import { selfRescheduleState } from './consultations.rescheduleRules';
import { ConsultRazorpay, normalizeRazorpayError, realConsultRazorpay } from './consultations.razorpay';
import { confirmedWithoutRazorpay, confirmPending, expireHold, freeConfirmation, holdSlot, walletConfirmation } from './consultations.transitions';
import { normalizeCode, recordPromoUse, takePromo } from './consultations.promo';
import { debitWallet, walletBalancePaise, walletText, WALLET_REF } from './consultations.wallet';
import { DOCTOR_LATE_AFTER_MS, noShowDeadlines } from './consultations.room';
import { DoctorError } from './doctors.status';
import { accessFor, familyWhere, isSelf, userMobile } from './consultations.family';
import { attachmentsFor, claimAttachments, type AttachmentStorage } from './consultations.attachments';
import { recordSharingView, writeRecordSharing, type ShareMeta } from './consultations.records';
import { overallRefundStatus } from './consultations.refunds';
import { INSTANT, claimInstantSlot, instantForBooking, instantRules } from './consultations.instant';
import { bookingReviewState } from './consultations.reviews';

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
    /** Photos / PDFs of outside records the booker uploaded just before (POST /attachments). */
    attachmentIds?: string[];
    /** Pay what the DocNow wallet covers from it; Razorpay collects the rest. */
    useWallet?: boolean;
    /** The wallet amount the patient was shown. A different amount now is refused, never silently used. */
    expectedWalletPaise?: number;
    /** A promo code; it must apply to consultations and to this doctor. */
    promoCode?: string;
    /** The discount the patient was shown for it. A different discount now is refused. */
    expectedDiscountPaise?: number;
    /**
     * "Let the doctor see my DocNow health record": the unticked box on review-and-pay. Not part of
     * the payment attempt (left out of the request hash); a repeat with another choice updates it.
     */
    shareRecord?: boolean;
    /** Where the consent came from, kept with it. */
    shareMeta?: ShareMeta;
    /** Paying for an instant consult a doctor accepted: the slot is that request's slot at "now". */
    instantRequestId?: string;
};

/** The wallet balance changed between showing it and booking (another tab spent it). */
export const WALLET_CHANGED = 'Your wallet balance just changed. Please check the amount and try again';
/** The promo code's discount changed between Apply and booking (the code was edited or limited). */
export const PROMO_CHANGED = 'Your promo code discount just changed. Please check the amount and try again';

export const MAX_ATTACHED_REPORTS = 5;
/** Base of the zero-login web room link sent to family members. */
export const guestJoinUrl = (token: string) => `${(process.env.GUEST_CALL_BASE_URL || 'https://docnow.in/call').replace(/\/+$/, '')}/${token}`;

const SLOT_TAKEN = 'Slot is no longer available';

function response(c: { id: string; holdExpiresAt: Date; status: string; feePaise: number; walletPaise: number; discountPaise: number }, orderId: string | null | undefined) {
    return {
        consultationId: c.id,
        status: c.status,
        razorpayOrderId: orderId ?? null,
        // What Razorpay collects. The fee and the wallet part are listed too, for the price breakdown.
        amountPaise: cardDuePaise(c),
        feePaise: c.feePaise,
        walletPaise: c.walletPaise,
        discountPaise: c.discountPaise,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID ?? null,
        holdExpiresAt: c.holdExpiresAt,
    };
}

/**
 * A repeated booking call while the hold is still open (the patient changed the box and pressed Pay
 * again): the latest choice wins. Once the booking is paid or ended, a repeat never changes sharing;
 * the booking page is the place for that.
 */
async function syncSharing<T extends { consultationId: string }>(db: PrismaClient, input: BookingInput, booked: T, now: Date): Promise<T> {
    if (input.shareRecord === undefined) return booked;
    await db.$transaction(async (tx) => {
        const open = await tx.consultation.count({ where: { id: booked.consultationId, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } } });
        if (open) await writeRecordSharing(tx, booked.consultationId, input.userId, input.shareRecord!, input.shareMeta ?? {}, now);
    });
    return booked;
}

async function existingBooking(db: PrismaClient, input: BookingInput, requestHash: string) {
    const found = await db.consultation.findUnique({
        where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
        include: { payments: { where: { source: 'RAZORPAY' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!found) return null;
    if (found.requestHash !== requestHash) throw new DoctorError(409, 'This idempotency key was used for a different request');
    // Paid in full from the wallet: it confirmed in the booking call itself, so a repeat gets the same answer.
    if (confirmedWithoutRazorpay(found.confirmingPaymentId)) return response(found, null);
    const orderId = found.payments[0]?.razorpayOrderId;
    if (found.status !== 'PENDING_PAYMENT') throw new DoctorError(409, 'This booking has ended. Start a new booking with a new idempotency key');
    if (!orderId) throw new DoctorError(409, 'This booking is still being set up. Try again in a moment');
    return response(found, orderId);
}

/** Expires a lapsed hold on a booked slot, but only after Razorpay confirms nothing was paid. */
async function releaseStaleHold(db: PrismaClient, razorpay: ConsultRazorpay, slotId: string, now: Date) {
    const held = await db.consultation.findFirst({
        where: { slotId, status: 'PENDING_PAYMENT' },
        include: { payments: { where: { source: 'RAZORPAY' } } },
    });
    if (!held || held.holdExpiresAt > now) throw new DoctorError(409, SLOT_TAKEN);
    try {
        for (const orderId of new Set(held.payments.map((p) => p.razorpayOrderId!))) {
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
    // The wallet choice and promo code are part of the request; left out when unused, so older hashes still match.
    const promoCode = normalizeCode(input.promoCode);
    const requestHash = createHash('sha256').update(`${input.slotId}|${input.patientId}${input.useWallet ? '|wallet' : ''}${promoCode ? `|promo:${promoCode}` : ''}${input.instantRequestId ? `|instant:${input.instantRequestId}` : ''}`).digest('hex');

    const repeated = await existingBooking(db, input, requestHash);
    if (repeated) return syncSharing(db, input, repeated, now);

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

    const instant = await instantForBooking(db, input, now);
    const slot = await db.slot.findUnique({ where: { id: input.slotId }, include: { doctor: true } });
    if (!slot || slot.doctor.status !== 'APPROVED') throw new DoctorError(404, 'Slot not available');

    const active = await getActivePolicy(db);
    const { id: policyId } = active;
    // An instant consult starts now: no lead time, its own rules (full refund until the doctor joins).
    const rules = instant ? instantRules(active.rules) : active.rules;
    if (!instant && slot.startsAt.getTime() < now.getTime() + rules.minLeadMinutes * 60_000) throw new DoctorError(400, 'This slot starts too soon to book');

    const open = await db.consultation.findMany({
        where: { userId: input.userId, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        select: { doctorId: true },
    });
    if (open.length >= MAX_OPEN_HOLDS_PER_USER) throw new DoctorError(429, 'Too many unpaid bookings. Finish or wait for them to expire');
    if (open.filter((o) => o.doctorId === slot.doctorId).length >= MAX_OPEN_HOLDS_PER_DOCTOR) {
        throw new DoctorError(429, 'You already have an unpaid booking with this doctor');
    }

    if (!instant && slot.status === 'BLOCKED') throw new DoctorError(409, SLOT_TAKEN);
    if (!instant && slot.status === 'BOOKED') await releaseStaleHold(db, razorpay, slot.id, now);

    const feePaise = toPaise(slot.doctor.consultationFee);
    if (feePaise <= 0) throw new DoctorError(400, 'This doctor has no fee set');
    // Instant: held until the pay-by time the patient sees, plus the grace for a payment already under
    // way (the matcher frees the doctor at the same moment, so the reconciler never expires it earlier).
    const holdExpiresAt = instant
        ? new Date(instant.payBy!.getTime() + INSTANT.payGraceMs)
        : new Date(Math.min(now.getTime() + rules.holdMinutes * 60_000, slot.startsAt.getTime() - rules.minLeadMinutes * 60_000));
    if (holdExpiresAt <= now) throw new DoctorError(400, 'This slot starts too soon to book');

    let consultation;
    try {
        consultation = await db.$transaction(async (tx) => {
            if (!instant && !(await holdSlot(tx, slot.id))) throw new DoctorError(409, SLOT_TAKEN);
            const promo = promoCode
                ? await takePromo(tx, { userId: input.userId, code: promoCode, doctor: { id: slot.doctorId, specialtyId: slot.doctor.specialtyId }, feePaise, now })
                : null;
            const discountPaise = promo?.discountPaise ?? 0;
            if (promo && input.expectedDiscountPaise !== undefined && input.expectedDiscountPaise !== discountPaise) {
                throw new DoctorError(409, PROMO_CHANGED);
            }
            const walletPaise = input.useWallet ? walletShare(feePaise - discountPaise, await walletBalancePaise(tx, input.userId)) : 0;
            if (input.useWallet && input.expectedWalletPaise !== undefined && input.expectedWalletPaise !== walletPaise) {
                throw new DoctorError(409, WALLET_CHANGED);
            }
            const created = await tx.consultation.create({
                data: {
                    userId: input.userId,
                    patientId: patient.id,
                    doctorId: slot.doctorId,
                    slotId: slot.id,
                    startsAt: slot.startsAt,
                    feePaise,
                    walletPaise,
                    discountPaise,
                    promoCodeId: promo?.promoCodeId ?? null,
                    platformFeePaise: feeFromBps(feePaise, rules.platformFeeBps),
                    policyId,
                    policySnapshot: rules as unknown as Prisma.InputJsonValue,
                    holdExpiresAt,
                    idempotencyKey: input.idempotencyKey,
                    requestHash,
                    orderReceipt: `c_${randomUUID().replace(/-/g, '')}`,
                    guestToken: randomUUID(),
                    isCaregiverJoined: forFamily && (input.isCaregiverJoined ?? true),
                    isInstant: !!instant,
                    ...(reportIds.length ? { attachedReports: { create: reportIds.map((reportId) => ({ reportId })) } } : {}),
                },
            });
            // Instant: ties this booking to the request and books its slot, unless another attempt is live.
            if (instant && !(await claimInstantSlot(tx, instant.id, slot.id, created.id, now))) throw new DoctorError(409, SLOT_TAKEN);
            await claimAttachments(tx, input.userId, created.id, input.attachmentIds ?? [], now);
            if (input.shareRecord) await writeRecordSharing(tx, created.id, input.userId, true, input.shareMeta ?? {}, now);
            if (promo) await recordPromoUse(tx, input.userId, promo.promoCodeId, created.id);
            if (walletPaise === 0) {
                if (cardDuePaise(created) > 0) return created;
                // The promo made it free: confirmed here, nothing to pay.
                if (!(await confirmPending(tx, created.id, freeConfirmation(created.id), now))) throw new Error('Free booking could not be confirmed');
                return tx.consultation.findUniqueOrThrow({ where: { id: created.id } });
            }

            // The wallet part is taken now, with the hold; it goes back if the hold ends unpaid.
            const part = await tx.consultationPayment.create({
                data: { consultationId: created.id, source: 'WALLET', amountPaise: walletPaise },
            });
            if (!(await debitWallet(tx, input.userId, walletPaise, { type: WALLET_REF.DEBIT, id: part.id }, walletText.paid(created.id)))) {
                throw new DoctorError(409, WALLET_CHANGED);
            }
            if (cardDuePaise(created) > 0) return created;
            // Paid in full from the wallet: confirmed here, with no Razorpay order.
            if (!(await confirmPending(tx, created.id, walletConfirmation(part.id), now))) throw new Error('Wallet booking could not be confirmed');
            return tx.consultation.findUniqueOrThrow({ where: { id: created.id } });
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const again = await existingBooking(db, input, requestHash);
            if (again) return syncSharing(db, input, again, now);
            throw new DoctorError(409, SLOT_TAKEN);
        }
        throw e;
    }

    if (consultation.status === 'CONFIRMED') return response(consultation, null);

    const amountPaise = cardDuePaise(consultation);
    let orderId: string;
    try {
        const order = await razorpay.createOrder({
            amountPaise,
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
    await db.consultationPayment.create({ data: { consultationId: consultation.id, razorpayOrderId: orderId, amountPaise } });
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
    promoCode: { select: { code: true } },
} satisfies Prisma.ConsultationInclude;

type BookingRow = Prisma.ConsultationGetPayload<{ include: typeof viewInclude }>;

/** What the patient screens need: the booking, who and when, and where payment and refund stand. */
function toView(c: BookingRow) {
    const live = c.refunds.filter((r) => !(r.status === 'FAILED' && r.failureConfirmed));
    const walletRefundPaise = live.filter((r) => c.payments.find((p) => p.id === r.paymentId)?.source === 'WALLET').reduce((sum, r) => sum + r.amountPaise, 0);
    const rxStatus = c.prescriptions.length > 0
        ? 'ISSUED'
        : c.note !== null
        ? 'DRAFTING'
        : (c.status === 'COMPLETED' ? 'NOT_REQUIRED' : 'PENDING');

    return {
        ...response(c, c.payments.find((p) => p.source === 'RAZORPAY')?.razorpayOrderId),
        startsAt: c.startsAt,
        endsAt: c.slot.endsAt,
        doctorId: c.doctorId,
        doctorName: c.doctor.displayName,
        specialty: c.doctor.specialty.name,
        patientId: c.patientId,
        patientName: c.patient.name,
        paymentCaptured: c.payments.some((p) => p.status === 'CAPTURED'),
        underStaffCheck: c.reviewReason !== null,
        promoCode: c.promoCode?.code ?? null,
        refundPaise: live.reduce((sum, r) => sum + r.amountPaise, 0),
        // The part of refundPaise that went back to the DocNow wallet (the rest goes to the card/UPI).
        walletRefundPaise,
        refundStatus: overallRefundStatus(live.length ? live : c.refunds),
        hasPrescription: c.prescriptions.length > 0,
        prescriptionId: c.prescriptions[0]?.id ?? null,
        rxStatus,
        type: c.type,
        isInstant: c.isInstant,
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
        // Whether the booker can change the time now, and the rules behind it, for the button and the text.
        selfReschedule: selfRescheduleState(c, new Date()),
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
        isInstant: base.isInstant,
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

/**
 * One booking. The detail view (not the list) carries the outside documents with fresh signed
 * links, for the booker and the accepted family member; never before the family member accepts.
 */
export async function getBooking(userId: string, consultationId: string, db: PrismaClient = prisma, storage?: AttachmentStorage) {
    const c = await db.consultation.findFirst({ where: { id: consultationId }, include: viewInclude });
    if (!c) throw new DoctorError(404, 'Not found');
    const access = accessFor(c, userId, c.userId === userId ? null : await userMobile(db, userId));
    if (!access) throw new DoctorError(404, 'Not found');
    const documents = () => attachmentsFor(c.id, { db, storage });
    const review = () => bookingReviewState(c, { db });
    if (access.kind === 'booker') return { ...toView(c), attachments: await documents(), recordSharing: await recordSharingView(c, db), review: await review() };
    if (c.status === 'PENDING_PAYMENT' || c.status === 'EXPIRED') throw new DoctorError(404, 'Not found');
    if (access.kind === 'family-pending') return familyView(c, false);
    return { ...familyView(c, true), attachments: await documents(), recordSharing: await recordSharingView(c, db), review: await review() };
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
