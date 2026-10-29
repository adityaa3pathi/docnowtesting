/** Doctor-late rules without a database: the lateness gate, the atomic move and the refund override. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./consultations.booking', () => ({ getBooking: vi.fn(async (_u: string, id: string) => ({ consultationId: id, status: 'CONFIRMED' })) }));
vi.mock('../../utils/logger', () => ({ logAlert: vi.fn(), logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { cancelConsultation, DOCTOR_NOT_LATE } from './consultations.cancellation';
import { DOCTOR_LATE_AFTER_MS, isDoctorLate } from './consultations.room';
import { NOT_LATE, rescheduleBooking, SLOT_GONE } from './consultations.reschedule';

const START = new Date('2026-11-02T10:00:00Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

const booking = (over: Record<string, unknown> = {}) => ({
    id: 'c-1', status: 'CONFIRMED', startsAt: START, doctorJoinedAt: null, doctorId: 'doc-1', slotId: 'slot-old',
    feePaise: 50000, policySnapshot: {}, doctor: { specialtyId: 'sp-1' }, ...over,
});

/** A fake Prisma whose transaction runs the callback against the same delegates. */
function fakeDb(opts: { booking?: Record<string, unknown> | null; slot?: Record<string, unknown> | null; holdCount?: number; moveCount?: number }) {
    const db = {
        consultation: {
            findFirst: vi.fn().mockResolvedValue(opts.booking === undefined ? booking() : opts.booking),
            updateMany: vi.fn().mockResolvedValue({ count: opts.moveCount ?? 1 }),
        },
        slot: {
            findUnique: vi.fn().mockResolvedValue(opts.slot === undefined ? { id: 'slot-new', doctorId: 'doc-1', startsAt: at(120), status: 'AVAILABLE' } : opts.slot),
            // holdSlot (AVAILABLE→BOOKED) first, then releaseSlot (BOOKED→AVAILABLE).
            updateMany: vi.fn().mockResolvedValueOnce({ count: opts.holdCount ?? 1 }).mockResolvedValue({ count: 1 }),
        },
        consultationNotification: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
        $transaction: vi.fn(),
    };
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
    return db;
}

describe('isDoctorLate', () => {
    it('is late from 5 minutes past the start while the doctor has not joined', () => {
        expect(DOCTOR_LATE_AFTER_MS).toBe(5 * 60_000);
        const c = { status: 'CONFIRMED' as const, startsAt: START, doctorJoinedAt: null };
        expect(isDoctorLate(c, at(4))).toBe(false);
        expect(isDoctorLate(c, at(5))).toBe(true);
        expect(isDoctorLate({ ...c, status: 'WAITING' }, at(7))).toBe(true);
    });

    it('is never late once the doctor joined, or after the visit moved on', () => {
        expect(isDoctorLate({ status: 'WAITING', startsAt: START, doctorJoinedAt: at(6) }, at(8))).toBe(false);
        for (const status of ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW_DOCTOR', 'COMPLETED'] as const) {
            expect(isDoctorLate({ status, startsAt: START, doctorJoinedAt: null }, at(8))).toBe(false);
        }
    });
});

describe('rescheduleBooking', () => {
    it('refuses before the doctor is late and changes nothing', async () => {
        const db = fakeDb({});
        await expect(rescheduleBooking('u-1', 'c-1', 'slot-new', { db: db as never, now: () => at(3) })).rejects.toMatchObject({ status: 409, message: NOT_LATE });
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('moves the booking atomically: books the new slot, repoints the visit, frees the old slot, resets time-bound notices', async () => {
        const db = fakeDb({});
        const view = await rescheduleBooking('u-1', 'c-1', 'slot-new', { db: db as never, now: () => at(6) });

        expect(db.slot.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'slot-new', status: 'AVAILABLE' }, data: { status: 'BOOKED' } });
        expect(db.consultation.updateMany).toHaveBeenCalledWith({
            where: { id: 'c-1', slotId: 'slot-old', status: { in: ['CONFIRMED', 'WAITING'] }, doctorJoinedAt: null },
            data: { doctorId: 'doc-1', slotId: 'slot-new', startsAt: at(120), status: 'CONFIRMED', patientJoinedAt: null, startedAt: null, roomId: null },
        });
        expect(db.slot.updateMany).toHaveBeenNthCalledWith(2, { where: { id: 'slot-old', status: 'BOOKED' }, data: { status: 'AVAILABLE' } });
        expect(db.consultationNotification.deleteMany).toHaveBeenCalledWith({
            where: { consultationId: 'c-1', kind: { in: ['CONFIRMED', 'REMINDER', 'JOIN_NOW', 'PARTNER_WAITING'] } },
        });
        expect(view).toMatchObject({ consultationId: 'c-1' });
    });

    it('rejects a slot another patient booked in the meantime, without touching the visit', async () => {
        const db = fakeDb({ holdCount: 0 });
        await expect(rescheduleBooking('u-1', 'c-1', 'slot-new', { db: db as never, now: () => at(6) })).rejects.toMatchObject({ status: 409, message: SLOT_GONE });
        expect(db.consultation.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a slot already shown as booked before trying', async () => {
        const db = fakeDb({ slot: { id: 'slot-new', doctorId: 'doc-1', startsAt: at(120), status: 'BOOKED' } });
        await expect(rescheduleBooking('u-1', 'c-1', 'slot-new', { db: db as never, now: () => at(6) })).rejects.toMatchObject({ status: 409 });
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("refuses another doctor's slot and one that starts too soon", async () => {
        const other = fakeDb({ slot: { id: 'slot-x', doctorId: 'doc-2', startsAt: at(120), status: 'AVAILABLE' } });
        await expect(rescheduleBooking('u-1', 'c-1', 'slot-x', { db: other as never, now: () => at(6) })).rejects.toMatchObject({ status: 404 });
        const soon = fakeDb({ slot: { id: 'slot-new', doctorId: 'doc-1', startsAt: at(15), status: 'AVAILABLE' } });
        await expect(rescheduleBooking('u-1', 'c-1', 'slot-new', { db: soon as never, now: () => at(6) })).rejects.toMatchObject({ status: 400 });
    });

    it('rolls back when the doctor joins in the same instant', async () => {
        const db = fakeDb({ moveCount: 0 });
        await expect(rescheduleBooking('u-1', 'c-1', 'slot-new', { db: db as never, now: () => at(6) })).rejects.toMatchObject({ status: 409 });
        // The throw inside $transaction undoes the slot hold; the old slot is never released.
        expect(db.slot.updateMany).toHaveBeenCalledTimes(1);
    });

    it("cannot touch someone else's booking", async () => {
        const db = fakeDb({ booking: null });
        await expect(rescheduleBooking('u-2', 'c-1', 'slot-new', { db: db as never, now: () => at(6) })).rejects.toMatchObject({ status: 404 });
    });
});

describe('cancel with DOCTOR_LATE', () => {
    const paidBooking = (over: Record<string, unknown> = {}) => ({
        ...booking(over),
        userId: 'u-1',
        confirmingPaymentId: 'pay_1',
        payments: [{ id: 'p-1', razorpayPaymentId: 'pay_1', amountPaise: 50000 }],
    });

    it('is refused when the doctor is not late, so the reason cannot be used to skip the tiers', async () => {
        const db = { consultation: { findFirst: vi.fn().mockResolvedValue(paidBooking()) }, $transaction: vi.fn() };
        await expect(cancelConsultation('c-1', { kind: 'booker', userId: 'u-1' }, 'DOCTOR_LATE', { db: db as never, now: () => at(2) })).rejects.toMatchObject({
            status: 409,
            message: DOCTOR_NOT_LATE,
        });
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('is refused once the doctor has joined', async () => {
        const db = { consultation: { findFirst: vi.fn().mockResolvedValue(paidBooking({ status: 'WAITING', doctorJoinedAt: at(6) })) }, $transaction: vi.fn() };
        await expect(cancelConsultation('c-1', { kind: 'booker', userId: 'u-1' }, 'DOCTOR_LATE', { db: db as never, now: () => at(8) })).rejects.toMatchObject({ status: 409 });
    });
});
