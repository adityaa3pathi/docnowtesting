/**
 * Real-Postgres test helpers. Suites run only when TEST_DATABASE_URL is set, and only against a
 * database whose name contains "test", because they truncate consultation tables.
 */
import { PrismaClient } from '@prisma/client';
import { describe } from 'vitest';
import { randomInt, randomUUID } from 'crypto';
import { ACTIVE_CONSULTATION_STATUSES } from '../consultations.types';

const url = process.env.TEST_DATABASE_URL;
if (url && !/test/i.test(new URL(url).pathname)) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test"');
}

export const testDb = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);
export const describeDb = url ? describe : describe.skip;

export const DEFAULT_POLICY_ID = 'default-consult-policy-v1';

export async function resetConsultData() {
    await testDb.$executeRawUnsafe('TRUNCATE "ConsultationRefund", "ConsultationPayment", "Consultation", "Slot" CASCADE');
    await testDb.consultPolicy.deleteMany({ where: { id: { not: DEFAULT_POLICY_ID } } });
    await testDb.consultPolicy.update({ where: { id: DEFAULT_POLICY_ID }, data: { isActive: true } });
}

export async function makeUser(role: 'USER' | 'DOCTOR' | 'SUPER_ADMIN' = 'USER') {
    const mobile = `7${randomInt(100000000, 999999999)}`;
    return testDb.user.create({ data: { mobile, name: `Test ${mobile}`, role } });
}

export async function makePatient(userId: string) {
    return testDb.patient.create({ data: { userId, name: 'Test Patient', relation: 'SELF', age: 30, gender: 'F' } });
}

export async function makeDoctor(overrides: { status?: 'APPROVED' | 'SUSPENDED' | 'PENDING' } = {}) {
    const user = await makeUser('DOCTOR');
    const specialty = await testDb.specialty.upsert({
        where: { name: 'Test Specialty' },
        update: {},
        create: { name: 'Test Specialty', slug: 'test-specialty' },
    });
    const profile = await testDb.doctorProfile.create({
        data: {
            userId: user.id,
            specialtyId: specialty.id,
            displayName: 'Dr Test',
            qualification: 'MBBS',
            registrationNumber: `T-${randomUUID().slice(0, 8)}`,
            registrationCouncil: 'Test Council',
            languages: ['English'],
            consultationFee: 500,
            status: overrides.status ?? 'APPROVED',
        },
    });
    return { user, profile };
}

export async function makeSlot(doctorId: string, startsInMinutes = 24 * 60, status: 'AVAILABLE' | 'BOOKED' | 'BLOCKED' = 'AVAILABLE') {
    const startsAt = new Date(Date.now() + startsInMinutes * 60_000);
    return testDb.slot.create({
        data: { doctorId, startsAt, endsAt: new Date(startsAt.getTime() + 15 * 60_000), status },
    });
}

export async function makeConsultation(input: {
    userId: string;
    patientId: string;
    doctorId: string;
    slotId: string;
    startsAt: Date;
    status?: import('../consultations.types').ConsultationStatus;
    idempotencyKey?: string;
}) {
    return testDb.consultation.create({
        data: {
            userId: input.userId,
            patientId: input.patientId,
            doctorId: input.doctorId,
            slotId: input.slotId,
            startsAt: input.startsAt,
            status: input.status ?? 'PENDING_PAYMENT',
            feePaise: 50000,
            platformFeePaise: 5000,
            policyId: DEFAULT_POLICY_ID,
            policySnapshot: {},
            holdExpiresAt: new Date(Date.now() + 10 * 60_000),
            idempotencyKey: input.idempotencyKey ?? randomUUID(),
            requestHash: 'hash',
            orderReceipt: `rcpt_${randomUUID().slice(0, 20)}`,
        },
    });
}

/** Rows that break "a slot is booked exactly when one active consultation points at it". Empty means consistent. */
export async function consistencyViolations(): Promise<{ id: string; problem: string }[]> {
    const active = ACTIVE_CONSULTATION_STATUSES.map((s) => `'${s}'`).join(', ');
    return testDb.$queryRawUnsafe(`
        SELECT s.id, 'booked_without_consultation' AS problem FROM "Slot" s
        WHERE s.status = 'BOOKED'
          AND NOT EXISTS (SELECT 1 FROM "Consultation" c WHERE c."slotId" = s.id AND c.status::text IN (${active}))
        UNION ALL
        SELECT c.id, 'active_on_unbooked_slot' FROM "Consultation" c JOIN "Slot" s ON s.id = c."slotId"
        WHERE c.status::text IN (${active}) AND s.status <> 'BOOKED'
    `);
}
