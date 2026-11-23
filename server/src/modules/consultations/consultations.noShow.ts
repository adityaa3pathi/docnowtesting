/**
 * Settles missed consultations. Doctor missing past their wait: NO_SHOW_DOCTOR and a full refund.
 * Doctor present, patient missing past theirs: NO_SHOW_PATIENT, no refund. Conditional updates only.
 */
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { ConsultRazorpay } from './consultations.razorpay';
import { paidParts } from './consultations.money';
import { createRefundRecord, runRefunds } from './consultations.refunds';
import { releasePromo } from './consultations.promo';
import { noShowDeadlines } from './consultations.room';
import { CEILINGS } from './consultations.policy';

type Deps = { db?: PrismaClient; razorpay?: ConsultRazorpay; now?: Date };

const LOOKBACK_MS = 48 * 3_600_000;
const MIN_WAIT_MS = CEILINGS.waitMinutes.min * 60_000;
const BATCH = 100;

export async function settleNoShows(deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const now = deps.now ?? new Date();
    const window = { gte: new Date(now.getTime() - LOOKBACK_MS), lte: new Date(now.getTime() - MIN_WAIT_MS) };
    let doctors = 0;
    let patients = 0;

    const doctorCandidates = await db.consultation.findMany({
        where: { status: { in: ['CONFIRMED', 'WAITING'] }, doctorJoinedAt: null, startsAt: window },
        select: { id: true, doctorId: true, startsAt: true, policySnapshot: true, confirmingPaymentId: true, payments: { select: { id: true, source: true, status: true, razorpayPaymentId: true } } },
        take: BATCH,
    });
    for (const c of doctorCandidates) {
        if (now < noShowDeadlines(c).doctorBy) continue;
        // Everything paid comes back: the card part to the card, the wallet part to the wallet.
        const parts = paidParts(c);
        const { changed, refunds } = await db.$transaction(async (tx) => {
            const res = await tx.consultation.updateMany({
                where: { id: c.id, status: { in: ['CONFIRMED', 'WAITING'] }, doctorJoinedAt: null },
                data: { status: 'NO_SHOW_DOCTOR' },
            });
            const made = [];
            // A doctor no-show is refunded in full, so the promo use comes back too.
            if (res.count === 1) await releasePromo(tx, c.id);
            if (res.count === 1) {
                for (const part of parts) {
                    const r = await createRefundRecord(tx, { consultationId: c.id, paymentId: part.id, reason: 'DOCTOR_NO_SHOW' });
                    if (r) made.push(r);
                }
            }
            return { changed: res.count === 1, refunds: made };
        });
        if (changed) {
            doctors++;
            // Staff follow up with the doctor; repeat offenders show on the admin doctor list.
            logAlert('consult_doctor_no_show', { consultationId: c.id, doctorId: c.doctorId });
        }
        // A booking a promo made free has no payment by design.
        if (changed && parts.length === 0 && !c.confirmingPaymentId?.startsWith('free:')) logAlert('consult_doctor_no_show_without_payment', { consultationId: c.id });
        // The reconciler retries a refund that fails here.
        await runRefunds(refunds, { db, razorpay: deps.razorpay });
    }

    const patientCandidates = await db.consultation.findMany({
        where: { status: 'IN_PROGRESS', patientJoinedAt: null, startsAt: window },
        select: { id: true, startsAt: true, policySnapshot: true },
        take: BATCH,
    });
    for (const c of patientCandidates) {
        if (now < noShowDeadlines(c).patientBy) continue;
        const res = await db.consultation.updateMany({
            where: { id: c.id, status: 'IN_PROGRESS', patientJoinedAt: null },
            data: { status: 'NO_SHOW_PATIENT', endedAt: now },
        });
        patients += res.count;
    }

    return { doctors, patients };
}
