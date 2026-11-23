/**
 * Promo codes on consultations. A code works here when it applies to CONSULT or BOTH, and, if it is
 * limited to doctors or specialties, the doctor or their specialty is one of them. The discount is
 * worked out in paise on the full fee. DocNow bears it: feePaise stays the full fee (Aditya, 2026-11-23).
 *
 * A use is claimed with the slot hold, under a lock on the code row, and given back when the hold
 * ends unpaid or the booking is refunded in full. A partial refund keeps it used (Aditya, 2026-11-23).
 */
import { DiscountType, PromoAppliesTo, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import type { Tx } from './consultations.transitions';
import { MIN_CARD_PAISE, toPaise } from './consultations.money';
import { DoctorError } from './doctors.status';

export type PromoRow = {
    id: string;
    code: string;
    description: string | null;
    discountType: DiscountType;
    discountValue: number;
    maxDiscount: number | null;
    minOrderValue: number;
    maxRedemptions: number | null;
    maxPerUser: number;
    redeemedCount: number;
    startsAt: Date;
    expiresAt: Date | null;
    isActive: boolean;
    appliesTo: PromoAppliesTo;
    scopes: { doctorId: string | null; specialtyId: string | null }[];
};
export type DoctorRef = { id: string; specialtyId: string };

export const normalizeCode = (raw: string | undefined | null) => (raw ?? '').trim().toUpperCase() || undefined;

/** The discount in paise on a fee. Percentages round half up once; never more than the fee. */
export function consultDiscountPaise(promo: Pick<PromoRow, 'discountType' | 'discountValue' | 'maxDiscount'>, feePaise: number): number {
    let discount = promo.discountType === 'PERCENTAGE'
        ? Math.floor((feePaise * promo.discountValue) / 100 + 0.5)
        : toPaise(promo.discountValue);
    if (promo.discountType === 'PERCENTAGE' && promo.maxDiscount) discount = Math.min(discount, toPaise(promo.maxDiscount));
    discount = Math.max(0, Math.min(discount, feePaise));
    // Razorpay can't take under ₹1: a discount that would leave less takes ₹1 off itself instead.
    const left = feePaise - discount;
    if (left > 0 && left < MIN_CARD_PAISE) discount = Math.max(0, feePaise - MIN_CARD_PAISE);
    return discount;
}

/** Whether the code is limited to doctors/specialties that leave this doctor out. */
export function outOfScope(promo: Pick<PromoRow, 'scopes'>, doctor: DoctorRef): boolean {
    if (promo.scopes.length === 0) return false;
    return !promo.scopes.some((s) => s.doctorId === doctor.id || s.specialtyId === doctor.specialtyId);
}

/** Why this code can't be used on this consultation right now, or null. The per-user check needs the database. */
export function promoProblem(promo: PromoRow | null, doctor: DoctorRef, feePaise: number, now: Date): string | null {
    if (!promo || !promo.isActive) return 'This promo code is not valid';
    if (promo.appliesTo === 'LAB') return 'This promo code is for lab tests, not consultations';
    if (now < promo.startsAt) return 'This promo code is not active yet';
    if (promo.expiresAt && now > promo.expiresAt) return 'This promo code has expired';
    if (outOfScope(promo, doctor)) return 'This promo code does not apply to this doctor';
    if (feePaise < toPaise(promo.minOrderValue)) return `This promo code needs a fee of at least ₹${promo.minOrderValue}`;
    if (promo.maxRedemptions !== null && promo.redeemedCount >= promo.maxRedemptions) return 'This promo code has been fully used';
    return null;
}

const usedUp = (maxPerUser: number) => (maxPerUser === 1 ? 'You have already used this promo code' : `You have used this promo code ${maxPerUser} times already`);

/** Uses of a code by a user, lab and consultations together. */
function usesBy(db: Pick<Tx, 'promoRedemption'>, userId: string, promoCodeId: string) {
    return db.promoRedemption.count({ where: { userId, promoCodeId } });
}

/**
 * Checks and takes one use of `code` for a consultation being held. Locks the code row first, so
 * two tabs (or a lab checkout) can't both take a user's last use or the code's last one.
 * Returns the code's id and the discount; throws a 400 DoctorError with the reason when it can't be used.
 */
export async function takePromo(tx: Tx, input: { userId: string; code: string; doctor: DoctorRef; feePaise: number; now: Date }) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PromoCode" WHERE code = ${input.code} FOR UPDATE`;
    const promo = locked ? await tx.promoCode.findUnique({ where: { id: locked.id }, include: { scopes: { select: { doctorId: true, specialtyId: true } } } }) : null;
    const problem = promoProblem(promo, input.doctor, input.feePaise, input.now);
    if (problem) throw new DoctorError(400, problem);
    if ((await usesBy(tx, input.userId, promo!.id)) >= promo!.maxPerUser) throw new DoctorError(400, usedUp(promo!.maxPerUser));
    await tx.promoCode.update({ where: { id: promo!.id }, data: { redeemedCount: { increment: 1 } } });
    return { promoCodeId: promo!.id, discountPaise: consultDiscountPaise(promo!, input.feePaise) };
}

/** Records the use against the consultation (one per consultation). */
export function recordPromoUse(tx: Tx, userId: string, promoCodeId: string, consultationId: string) {
    return tx.promoRedemption.create({ data: { userId, promoCodeId, consultationId } });
}

/** Gives the use back: an unpaid hold that ended, or a full refund. Idempotent. */
export async function releasePromo(tx: Tx, consultationId: string): Promise<void> {
    const used = await tx.promoRedemption.findUnique({ where: { consultationId } });
    if (!used) return;
    await tx.promoRedemption.delete({ where: { id: used.id } });
    await tx.promoCode.updateMany({ where: { id: used.promoCodeId, redeemedCount: { gt: 0 } }, data: { redeemedCount: { decrement: 1 } } });
}

/**
 * A late card payment brings an expired hold back. The patient paid the discounted price, so the use
 * is taken again even if the code has since run out (the price was already agreed and paid).
 */
export async function retakePromo(tx: Tx, consultationId: string): Promise<void> {
    const c = await tx.consultation.findUniqueOrThrow({ where: { id: consultationId }, select: { userId: true, promoCodeId: true } });
    if (!c.promoCodeId) return;
    const res = await tx.$executeRaw`
        INSERT INTO "PromoRedemption" ("id", "userId", "promoCodeId", "consultationId", "redeemedAt")
        VALUES (gen_random_uuid()::text, ${c.userId}, ${c.promoCodeId}, ${consultationId}, now())
        ON CONFLICT ("consultationId") DO NOTHING`;
    if (res === 1) await tx.promoCode.update({ where: { id: c.promoCodeId }, data: { redeemedCount: { increment: 1 } } });
}

/** The patient's "Apply" check, before booking: same rules as the booking, nothing taken. */
export async function checkConsultPromo(userId: string, rawCode: string, slotId: string, db: PrismaClient = prisma, now = new Date()) {
    const code = normalizeCode(rawCode);
    if (!code) throw new DoctorError(400, 'Enter a promo code');
    const slot = await db.slot.findUnique({ where: { id: slotId }, include: { doctor: { select: { id: true, specialtyId: true, consultationFee: true, status: true } } } });
    if (!slot || slot.doctor.status !== 'APPROVED') throw new DoctorError(404, 'Slot not available');
    const feePaise = toPaise(slot.doctor.consultationFee);
    const promo = await db.promoCode.findUnique({ where: { code }, include: { scopes: { select: { doctorId: true, specialtyId: true } } } });
    const problem = promoProblem(promo, slot.doctor, feePaise, now);
    if (problem) throw new DoctorError(400, problem);
    if ((await usesBy(db, userId, promo!.id)) >= promo!.maxPerUser) throw new DoctorError(400, usedUp(promo!.maxPerUser));
    return { code: promo!.code, description: promo!.description, discountPaise: consultDiscountPaise(promo!, feePaise), feePaise };
}

/** Codes this patient can use with this doctor now, for the list under the promo box. */
export async function availableConsultPromos(userId: string, doctorId: string, db: PrismaClient = prisma, now = new Date()) {
    const doctor = await db.doctorProfile.findUnique({ where: { id: doctorId }, select: { id: true, specialtyId: true, consultationFee: true, status: true } });
    if (!doctor || doctor.status !== 'APPROVED') throw new DoctorError(404, 'Not found');
    const feePaise = toPaise(doctor.consultationFee);
    const promos = await db.promoCode.findMany({
        where: {
            isActive: true,
            appliesTo: { in: ['CONSULT', 'BOTH'] },
            startsAt: { lte: now },
            AND: [
                { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                // Scope in the query, so codes for other doctors can't crowd out ones that fit.
                { OR: [{ scopes: { none: {} } }, { scopes: { some: { OR: [{ doctorId: doctor.id }, { specialtyId: doctor.specialtyId }] } } }] },
            ],
        },
        include: { scopes: { select: { doctorId: true, specialtyId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
    });
    const usable = promos.filter((p) => promoProblem(p, doctor, feePaise, now) === null);
    const uses = await db.promoRedemption.groupBy({ by: ['promoCodeId'], where: { userId, promoCodeId: { in: usable.map((p) => p.id) } }, _count: { _all: true } });
    const usedCount = new Map(uses.map((u) => [u.promoCodeId, u._count._all]));
    return usable
        .filter((p) => (usedCount.get(p.id) ?? 0) < p.maxPerUser)
        .map((p) => ({ code: p.code, description: p.description, discountPaise: consultDiscountPaise(p, feePaise) }));
}
