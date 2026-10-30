/**
 * In-app account deletion (App Store Guideline 5.1.1(v)).
 *
 * What goes: the person's contact details and login (name, mobile, email, password, sessions, push
 * tokens, OTPs), saved addresses, cart, family profiles never used for a booking, phone links to
 * family profiles, and uploads never attached to a booking. The account is blocked, so every
 * existing token stops working at once.
 *
 * What stays, de-identified: consultation records and prescriptions (doctors must keep them under
 * the NMC Telemedicine Practice Guidelines), lab bookings, payments, refunds and invoices (tax law),
 * and consent records. They no longer lead back to a phone number or login.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { s3AttachmentStorage, type AttachmentStorage } from '../modules/consultations/consultations.attachments';

export const ACTIVE_CONSULTATION_MESSAGE = 'Please complete or cancel your upcoming consultation before deleting your account';
export const STAFF_ACCOUNT_MESSAGE = 'Doctor and staff accounts are closed by DocNow support. Please contact support to close this account.';
export const DELETED_MESSAGE = 'Account deleted successfully';

export class AccountDeletionError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

/** A consultation still to happen, or a payment that may still be captured. */
const ACTIVE_STATUSES = ['CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS'] as const;

/** The unique placeholder that replaces the mobile number, so the number can sign up afresh. */
export const deletedMobile = (userId: string) => `deleted:${userId}`;

type Deps = { db?: PrismaClient; storage?: AttachmentStorage; now?: Date };

export async function deleteAccount(userId: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    const now = deps.now ?? new Date();

    const removedFiles = await db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true, mobile: true, role: true, deletedAt: true, doctorProfile: { select: { id: true } } },
        });
        if (!user || user.deletedAt) throw new AccountDeletionError(404, 'Account not found');
        // A doctor's patients need their records to stay with a registered doctor; staff accounts hold admin history.
        if (user.role !== 'USER' || user.doctorProfile) throw new AccountDeletionError(400, STAFF_ACCOUNT_MESSAGE);

        const active = await tx.consultation.count({
            where: {
                userId,
                OR: [{ status: { in: [...ACTIVE_STATUSES] } }, { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } }],
            },
        });
        if (active > 0) throw new AccountDeletionError(400, ACTIVE_CONSULTATION_MESSAGE);

        const files = await tx.consultationAttachment.findMany({ where: { userId, consultationId: null }, select: { storageKey: true } });

        await tx.pushToken.deleteMany({ where: { userId } });
        await tx.session.deleteMany({ where: { userId } });
        await tx.oTP.deleteMany({ where: { identifier: user.mobile } });
        await tx.cart.deleteMany({ where: { userId } });
        await tx.consultationAttachment.deleteMany({ where: { userId, consultationId: null } });
        await tx.address.updateMany({ where: { userId }, data: { isDeleted: true, line1: 'Removed (account deleted)', lat: null, long: null } });

        // Someone else's family profile that pointed at this account stops showing up here.
        await tx.patient.updateMany({ where: { linkedUserId: userId }, data: { linkedUserId: null, linkedAt: null } });
        // Own family profiles: unused ones go; ones on a booking keep only what the medical record needs.
        await tx.patient.deleteMany({ where: { userId, bookingItems: { none: {} }, consultations: { none: {} }, cartItems: { none: {} } } });
        await tx.patient.updateMany({ where: { userId }, data: { phone: null, linkedUserId: null, linkedAt: null, linkDeclinedAt: null } });

        await tx.user.update({
            where: { id: userId },
            data: {
                name: null,
                email: null,
                mobile: deletedMobile(userId),
                password: null,
                gender: null,
                age: null,
                dob: null,
                referralCode: null,
                status: 'BLOCKED',
                deletedAt: now,
                tokenVersion: { increment: 1 },
            },
        });
        return files;
    });

    // After the commit: a storage hiccup must not undo the deletion, and the rows are already gone.
    await Promise.all(removedFiles.map((f) => storage.remove(f.storageKey).catch(() => {})));
    return { success: true as const, message: DELETED_MESSAGE };
}
