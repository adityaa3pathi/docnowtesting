/**
 * Assisted family consultations. The unit tests use fake databases and always run; the
 * integration suite at the end needs TEST_DATABASE_URL (real Postgres) and is skipped without it.
 */
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeIndianMobile, patientHealthSchema, relinkFields } from '../../utils/patientValidation';
import { createSignedToken, verifySignedToken } from '../../services/signedToken';
import { guestJoinUrl, getBooking, listBookings } from './consultations.booking';
import { accessFor, familyWhere } from './consultations.family';
import { dosageSummary, localizeDosage } from './consultations.familyMessages';
import { dueFamilyNotices } from './consultations.notifications';
import { duePushes, pushMessage, sendDuePushes, type ExpoMessage, type ExpoTicket, type PushRow } from './consultations.push';
import { realConsultVideo } from './consultations.video';
import { describeDb, makeDoctor, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { FakeVideo } from './test/fakeVideo';
import { useTestJwtSecret } from './test/http';

useTestJwtSecret();

const START = new Date('2026-11-02T10:00:00.000Z'); // 3:30 PM IST
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const BOOKER = 'user-booker';
const FAMILY = 'user-mother';
const MOTHER_PHONE = '9876543210';

// ── Phone and intake validation ─────────────────────────

describe('family member phone and health snapshot', () => {
    it('accepts the ways people type an Indian mobile and stores 10 digits', () => {
        expect(normalizeIndianMobile('+91 98765 43210')).toBe('9876543210');
        expect(normalizeIndianMobile('098765-43210')).toBe('9876543210');
        expect(normalizeIndianMobile('9876543210')).toBe('9876543210');
        expect(normalizeIndianMobile('12345')).toBeNull();
        expect(normalizeIndianMobile('5876543210')).toBeNull(); // Indian mobiles start 6-9
    });

    it('validates the intake and drops repeated chips', () => {
        const out = patientHealthSchema.parse({
            phone: '+91 98765 43210',
            preferredLanguage: 'hi',
            chronicConditions: ['Diabetes', 'Diabetes', 'Hypertension'],
            allergies: ['Penicillin'],
            currentMedications: ['Metformin 500mg'],
        });
        expect(out).toMatchObject({ phone: '9876543210', chronicConditions: ['Diabetes', 'Hypertension'] });
        expect(patientHealthSchema.safeParse({ phone: '123' }).success).toBe(false);
        expect(patientHealthSchema.safeParse({ preferredLanguage: 'fr' }).success).toBe(false);
        expect(patientHealthSchema.parse({ phone: '' }).phone).toBeNull();
    });

    it('starts the family link over when the phone changes', () => {
        expect(relinkFields({ phone: MOTHER_PHONE }, { phone: '9123456789' })).toEqual({ linkedUserId: null, linkedAt: null, linkDeclinedAt: null });
        expect(relinkFields({ phone: MOTHER_PHONE }, { phone: MOTHER_PHONE })).toEqual({});
        expect(relinkFields({ phone: MOTHER_PHONE }, {})).toEqual({});
    });
});

// ── Who may see a consultation ──────────────────────────

describe('access rule', () => {
    const c = (patient: Partial<{ relation: string; phone: string | null; linkedUserId: string | null; linkDeclinedAt: Date | null }> = {}) => ({
        userId: BOOKER,
        patient: { relation: 'Parent', phone: MOTHER_PHONE, linkedUserId: null, linkDeclinedAt: null, ...patient },
    });

    it('the booker always has access; a family visit makes them the caregiver', () => {
        expect(accessFor(c({ relation: 'Self' }), BOOKER, null)).toEqual({ kind: 'booker', forFamily: false });
        expect(accessFor(c(), BOOKER, null)).toEqual({ kind: 'booker', forFamily: true });
    });

    it('the owner of the patient phone sees it pending until they accept, then in full', () => {
        expect(accessFor(c(), FAMILY, MOTHER_PHONE)).toEqual({ kind: 'family-pending' });
        expect(accessFor(c({ linkedUserId: FAMILY }), FAMILY, MOTHER_PHONE)).toEqual({ kind: 'family' });
    });

    it('nobody else: another number, a declined link, a link to another account, or a Self visit', () => {
        expect(accessFor(c(), FAMILY, '9000000000')).toBeNull();
        expect(accessFor(c({ linkDeclinedAt: at(0) }), FAMILY, MOTHER_PHONE)).toBeNull();
        expect(accessFor(c({ linkedUserId: 'someone-else' }), FAMILY, MOTHER_PHONE)).toBeNull();
        expect(accessFor(c({ relation: 'Self' }), FAMILY, MOTHER_PHONE)).toBeNull();
        expect(accessFor(c({ phone: null }), FAMILY, MOTHER_PHONE)).toBeNull();
    });

    it('lists by patient phone, excluding Self visits, declined links and links to someone else', () => {
        expect(familyWhere(FAMILY, MOTHER_PHONE)).toEqual({
            userId: { not: FAMILY },
            patient: {
                phone: MOTHER_PHONE,
                NOT: { relation: { equals: 'Self', mode: 'insensitive' } },
                linkDeclinedAt: null,
                OR: [{ linkedUserId: null }, { linkedUserId: FAMILY }],
            },
        });
    });
});

// ── Listing and booking views (fake database) ───────────

function bookingRow(over: Record<string, unknown> = {}, patient: Record<string, unknown> = {}) {
    return {
        id: 'c-1', userId: BOOKER, patientId: 'p-mother', doctorId: 'doc-1', slotId: 's-1', status: 'CONFIRMED', type: 'VIDEO',
        startsAt: START, createdAt: at(-3 * 24 * 60), holdExpiresAt: at(-60), feePaise: 50000, policySnapshot: {},
        doctorJoinedAt: null, patientJoinedAt: null, cancelReason: null, reviewReason: null,
        guestToken: '11111111-2222-3333-4444-555555555555', isCaregiverJoined: true,
        doctor: { displayName: 'Sharma', photoUrl: null, qualification: 'MBBS', specialty: { name: 'General Physician' } },
        patient: { name: 'Sunita Verma', relation: 'Parent', phone: MOTHER_PHONE, linkedUserId: null, linkDeclinedAt: null, ...patient },
        user: { name: 'Aditya Verma' },
        slot: { endsAt: at(15) },
        payments: [{ razorpayOrderId: 'order_1', status: 'CAPTURED' }],
        refunds: [],
        prescriptions: [{ id: 'rx-1' }],
        note: null,
        ...over,
    };
}

function listDb(own: unknown[], family: unknown[], mobile: string | null) {
    return {
        user: { findUnique: vi.fn().mockResolvedValue(mobile ? { mobile } : null) },
        consultation: { findMany: vi.fn().mockResolvedValueOnce(own).mockResolvedValueOnce(family), findFirst: vi.fn() },
    };
}

describe('consultation listing matches the booker and the patient phone', () => {
    it("the booker's view carries the forwardable call link and the family link state", async () => {
        const db = listDb([bookingRow()], [], '9999999999');
        const [view] = await listBookings(BOOKER, db as never);
        expect(view).toMatchObject({
            isBookedForYou: false,
            isCaregiverJoined: true,
            guestJoinUrl: 'https://docnow.in/call/11111111-2222-3333-4444-555555555555',
            familyLinked: false,
            amountPaise: 50000,
        });
    });

    it('the family member sees it as booked for them, before accepting with nothing clinical or financial', async () => {
        const db = listDb([], [bookingRow()], MOTHER_PHONE);
        const [view] = await listBookings(FAMILY, db as never);

        expect(db.consultation.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: { AND: [familyWhere(FAMILY, MOTHER_PHONE), { status: { notIn: ['PENDING_PAYMENT', 'EXPIRED'] } }] },
        }));
        expect(view).toMatchObject({ isBookedForYou: true, familyAccess: 'pending', bookedBy: { name: 'Aditya Verma', relation: 'Parent' }, doctorName: 'Sharma' });
        expect(view).not.toHaveProperty('hasPrescription');
        expect(view).not.toHaveProperty('guestToken');
        expect(view.amountPaise).toBe(0);
    });

    it('after accepting, the family member sees the prescription state too', async () => {
        const db = listDb([], [bookingRow({}, { linkedUserId: FAMILY })], MOTHER_PHONE);
        const [view] = await listBookings(FAMILY, db as never);
        expect(view).toMatchObject({ familyAccess: 'linked', hasPrescription: true, rxStatus: 'ISSUED' });
    });

    it('a user without a mobile only gets their own bookings', async () => {
        const db = listDb([bookingRow({ id: 'own' })], [], null);
        expect(await listBookings(FAMILY, db as never)).toHaveLength(1);
        expect(db.consultation.findMany).toHaveBeenCalledTimes(1);
    });

    it('a stranger cannot open the booking at all', async () => {
        const db = { user: { findUnique: vi.fn().mockResolvedValue({ mobile: '9000000000' }) }, consultation: { findFirst: vi.fn().mockResolvedValue(bookingRow()) } };
        await expect(getBooking('stranger', 'c-1', db as never)).rejects.toMatchObject({ status: 404 });
    });
});

// ── Dual push dispatch (fake database) ──────────────────

const okSend = () => vi.fn(async (msgs: ExpoMessage[]): Promise<ExpoTicket[]> => msgs.map((_, i) => ({ status: 'ok', id: `t${i}` })));

function pushRow(over: Partial<PushRow> = {}, patient: Partial<PushRow['patient']> = {}): PushRow {
    return {
        id: 'c-1', status: 'CONFIRMED', startsAt: START, createdAt: at(-3 * 24 * 60), userId: BOOKER,
        doctorJoinedAt: null, patientJoinedAt: null, familyJoinedAt: null,
        slot: { endsAt: at(15) },
        doctor: { displayName: 'Sharma', userId: 'doctor-user' },
        refunds: [],
        prescriptions: [],
        patient: { name: 'Sunita Verma', relation: 'Parent', phone: MOTHER_PHONE, linkedUserId: FAMILY, linkDeclinedAt: null, ...patient },
        user: { name: 'Aditya Verma' },
        ...over,
    } as PushRow;
}

function pushDb(rows: PushRow[], tokens: { userId: string; token: string }[], phoneOwners: { id: string; mobile: string }[] = []) {
    return {
        consultation: { findMany: vi.fn().mockResolvedValue(rows) },
        user: { findMany: vi.fn().mockResolvedValue(phoneOwners) },
        pushToken: { findMany: vi.fn().mockResolvedValue(tokens), deleteMany: vi.fn() },
        consultationNotification: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn().mockResolvedValue({}) },
    };
}

const sentTo = (send: ReturnType<typeof okSend>, token: string) => send.mock.calls.map((c) => c[0]).flat().filter((m) => m.to === token);

describe('dual push: caregiver and family member', () => {
    const tokens = [
        { userId: BOOKER, token: 'ExponentPushToken[son]' },
        { userId: FAMILY, token: 'ExponentPushToken[mother]' },
    ];

    it('10-minute reminder goes to both phones, each in its own words', async () => {
        const db = pushDb([pushRow()], tokens);
        const send = okSend();
        await sendDuePushes({ db: db as never, now: at(-5), send });

        const mother = sentTo(send, 'ExponentPushToken[mother]').find((m) => m.data.kind === 'JOIN_NOW');
        const son = sentTo(send, 'ExponentPushToken[son]').find((m) => m.data.kind === 'JOIN_NOW');
        expect(mother).toMatchObject({ title: 'Dr. Sharma will call you in 10 minutes', body: 'Booked by Aditya. Tap to join from your phone.' });
        expect(son).toMatchObject({ title: "Sunita's consultation starts in 10 minutes", body: 'Join to assist Sunita with Dr. Sharma.' });
        expect(db.consultationNotification.create).toHaveBeenCalledWith({ data: { consultationId: 'c-1', kind: 'JOIN_NOW', recipient: 'family', channel: 'push' } });
    });

    it('when the doctor is in and the family member is not, she gets the call alert even if the caregiver joined', async () => {
        const row = pushRow({ status: 'IN_PROGRESS', doctorJoinedAt: at(1), patientJoinedAt: at(0) });
        const send = okSend();
        await sendDuePushes({ db: pushDb([row], tokens) as never, now: at(2), send });
        expect(sentTo(send, 'ExponentPushToken[mother]').find((m) => m.data.kind === 'PARTNER_WAITING')).toMatchObject({
            title: 'Dr. Sharma is waiting for you',
            channelId: 'teleconsult-call',
        });
    });

    it('prescription: both get it once the family member has accepted', async () => {
        const row = pushRow({ status: 'COMPLETED', prescriptions: [{ id: 'rx-1', recommendedTests: [{ code: 'CBC', name: 'CBC' }] }] as PushRow['prescriptions'] });
        const send = okSend();
        await sendDuePushes({ db: pushDb([row], tokens) as never, now: at(30), send });
        expect(sentTo(send, 'ExponentPushToken[mother]')[0]).toMatchObject({
            title: 'Your prescription is ready',
            body: 'Your prescription from Dr. Sharma is ready with recommended tests.',
            data: { url: 'docnow://records/prescription/c-1' },
        });
        expect(sentTo(send, 'ExponentPushToken[son]')[0]?.title).toBe('Prescription ready for Sunita Verma');
    });

    it('before accepting: generic reminder to whoever owns the number, and never the prescription', async () => {
        const unlinked = { linkedUserId: null };
        const owners = [{ id: FAMILY, mobile: MOTHER_PHONE }];

        const send = okSend();
        await sendDuePushes({ db: pushDb([pushRow({}, unlinked)], tokens, owners) as never, now: at(-5), send });
        const reminder = sentTo(send, 'ExponentPushToken[mother]')[0];
        expect(reminder?.title).toBe('Your consultation starts in 10 minutes');
        expect(reminder?.body).not.toContain('Sharma');

        const rx = pushRow({ status: 'COMPLETED', prescriptions: [{ id: 'rx-1', recommendedTests: [] }] as PushRow['prescriptions'] }, unlinked);
        expect(duePushes(rx, at(30))).not.toContainEqual(['PRESCRIPTION_ISSUED', 'family']);
    });

    it('sends nothing to the family when the number was declined, and never twice to the same person', async () => {
        expect(duePushes(pushRow({}, { linkDeclinedAt: at(-100), linkedUserId: null }), at(-5)).filter(([, to]) => to === 'family')).toEqual([]);

        // The booker signed in with the patient's own number (e.g. a shared phone): one push, not two.
        const same = pushRow({}, { linkedUserId: BOOKER });
        const send = okSend();
        await sendDuePushes({ db: pushDb([same], [{ userId: BOOKER, token: 'ExponentPushToken[son]' }]) as never, now: at(-5), send });
        expect(sentTo(send, 'ExponentPushToken[son]').filter((m) => m.data.kind === 'JOIN_NOW')).toHaveLength(1);
    });

    it('a Self visit is unchanged: one patient push, booker wording', () => {
        const self = pushRow({}, { relation: 'Self', phone: null, linkedUserId: null });
        expect(duePushes(self, at(-5)).filter(([, to]) => to === 'family')).toEqual([]);
        expect(pushMessage('JOIN_NOW', 'patient', self).title).toBe('Your consultation starts in 10 minutes');
    });
});

// ── Family WhatsApp ─────────────────────────────────────

describe('family WhatsApp messages', () => {
    const base = {
        status: 'CONFIRMED', startsAt: START, slot: { endsAt: at(15) }, guestToken: 'g-1', familyJoinedAt: null as Date | null,
        patient: { relation: 'Parent', phone: MOTHER_PHONE, linkedUserId: null as string | null, linkDeclinedAt: null as Date | null },
        prescriptions: [] as unknown[],
    };

    it('sends the booking with its call link, then the link again when the room opens', () => {
        expect(dueFamilyNotices(base, at(-60))).toEqual(['FAMILY_BOOKED']);
        expect(dueFamilyNotices(base, at(-5))).toEqual(['FAMILY_JOIN_NOW']);
        expect(dueFamilyNotices({ ...base, familyJoinedAt: at(-2) }, at(-1))).toEqual([]);
    });

    it('sends the prescription only once the number is proven: accepted in the app, or attended from the link', () => {
        const done = { ...base, status: 'COMPLETED', prescriptions: [{}] };
        expect(dueFamilyNotices(done, at(30))).toEqual([]);
        expect(dueFamilyNotices({ ...done, familyJoinedAt: at(1) }, at(30))).toEqual(['FAMILY_PRESCRIPTION']);
        expect(dueFamilyNotices({ ...done, patient: { ...done.patient, linkedUserId: FAMILY } }, at(30))).toEqual(['FAMILY_PRESCRIPTION']);
    });

    it('writes the dosage simply in Hindi', () => {
        expect(localizeDosage('1-0-1 (morning, night)', 'hi')).toBe('1-0-1 (सुबह, रात)');
        expect(
            dosageSummary([{ name: 'Paracetamol 650mg', dose: '', frequency: '1-0-1 (morning, night)', duration: '5 Days', instructions: 'After Food' }], 'hi'),
        ).toBe('1. Paracetamol 650mg: 1-0-1 (सुबह, रात), खाने के बाद, 5 दिन');
        expect(dosageSummary([], 'en')).toBe('No medicines prescribed.');
        const many = Array.from({ length: 40 }, (_, i) => ({ name: `Medicine number ${i}`, frequency: '1-1-1 (morning, afternoon, night)', duration: '14 Days' }));
        expect(dosageSummary(many, 'en')).toMatch(/\+\d+ more$/);
    });
});

// ── Room identities and signed links ────────────────────

describe('three-way call identities', () => {
    it('tokens name who is who, and only the doctor may send room events', async () => {
        process.env.LIVEKIT_URL = 'wss://lk.test';
        process.env.LIVEKIT_API_KEY = 'APItest';
        process.env.LIVEKIT_API_SECRET = 'secret-secret-secret-secret-secret';
        try {
            const caretaker = jwt.decode(await realConsultVideo().joinToken('r', 'caretaker:user-1', 'Aditya (family)', 'caretaker')) as { sub: string; video: { canPublishData: boolean } };
            expect(caretaker.sub).toBe('caretaker:user-1');
            expect(caretaker.video.canPublishData).toBe(false);
            const doctor = jwt.decode(await realConsultVideo().joinToken('r', 'doctor:doc-1', 'Dr. A', 'doctor')) as { video: { canPublishData: boolean } };
            expect(doctor.video.canPublishData).toBe(true);
        } finally {
            process.env.LIVEKIT_URL = '';
            process.env.LIVEKIT_API_KEY = '';
            process.env.LIVEKIT_API_SECRET = '';
        }
    });
});

describe('signed prescription links', () => {
    it('open within their time, for their own purpose only', () => {
        const token = createSignedToken('consult-prescription', 'c-1', 72, START.getTime());
        expect(verifySignedToken('consult-prescription', token, START.getTime() + 3_600_000)).toBe('c-1');
        expect(() => verifySignedToken('consult-prescription', token, START.getTime() + 73 * 3_600_000)).toThrow('This link has expired');
        expect(() => verifySignedToken('report', token, START.getTime())).toThrow('Invalid link');
        expect(() => verifySignedToken('consult-prescription', `${token}x`, START.getTime())).toThrow('Invalid link');
    });

    it('guest links use the configured base', () => {
        expect(guestJoinUrl('abc')).toBe('https://docnow.in/call/abc');
    });
});

// ── Integration: real Postgres ──────────────────────────

describeDb('assisted family consultation (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let family: typeof import('./consultations.family');
    let room: typeof import('./consultations.room');
    let rx: typeof import('./consultations.prescription');
    let razorpay: FakeRazorpay;
    let video: FakeVideo;

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        family = await import('./consultations.family');
        room = await import('./consultations.room');
        rx = await import('./consultations.prescription');
    });
    afterAll(async () => {
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
        video = new FakeVideo();
    });
    afterEach(() => vi.useRealTimers());

    let n = 0;
    /** Aditya books for his mother, whose own phone is `motherMobile`. */
    async function familyBooking(minutesAhead = 60) {
        const doctor = await makeDoctor();
        const son = await makeUser();
        const mother = await makeUser();
        const patient = await testDb.patient.create({
            data: { userId: son.id, name: 'Sunita Verma', relation: 'Parent', age: 64, gender: 'Female', phone: mother.mobile, preferredLanguage: 'hi', chronicConditions: ['Diabetes'] },
        });
        const slot = await makeSlot(doctor.profile.id, minutesAhead);
        const res = await booking.createBooking({ userId: son.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-family-${++n}-12345` }, { razorpay });
        await payments.confirmPayment({ paymentId: `pay_fam${String(n).padStart(7, '0')}`, orderId: res.razorpayOrderId!, amountPaise: res.amountPaise, currency: 'INR' });
        return { doctor, son, mother, patient, slot, id: res.consultationId };
    }
    const issue = (consultationId: string) =>
        testDb.prescription.create({
            data: {
                consultationId,
                medicines: [{ name: 'Metformin 500mg', dose: '', frequency: '1-0-1 (morning, night)', duration: '30 Days', instructions: 'After Food' }],
                recommendedTests: [],
                doctorSnapshot: { displayName: 'Dr Test', qualification: 'MBBS', registrationNumber: 'R', registrationCouncil: 'C', specialty: 'GP' },
                patientSnapshot: { name: 'Sunita Verma', age: 64, gender: 'Female' },
            },
        });

    it('generates a guest token on booking and gives the booker the link; co-join defaults on', async () => {
        const b = await familyBooking();
        const c = await testDb.consultation.findUniqueOrThrow({ where: { id: b.id } });
        expect(c.guestToken).toMatch(/^[0-9a-f-]{36}$/);
        expect(c.isCaregiverJoined).toBe(true);
        const view = await booking.getBooking(b.son.id, b.id);
        expect(view).toMatchObject({ guestJoinUrl: `https://docnow.in/call/${c.guestToken}`, isBookedForYou: false });
    });

    it("lists it for the mother's own account, pending until she accepts; declining hides it", async () => {
        const b = await familyBooking();
        let [mine] = await booking.listBookings(b.mother.id);
        expect(mine).toMatchObject({ consultationId: b.id, isBookedForYou: true, familyAccess: 'pending' });

        await family.acceptFamilyLink(b.mother.id, b.patient.id);
        [mine] = await booking.listBookings(b.mother.id);
        expect(mine).toMatchObject({ familyAccess: 'linked' });

        const other = await familyBooking();
        await family.declineFamilyLink(other.mother.id, other.patient.id);
        expect(await booking.listBookings(other.mother.id)).toEqual([]);
    });

    it('lets the booker and the accepted family member read the prescription; nobody else', async () => {
        const b = await familyBooking();
        await issue(b.id);
        const stranger = await makeUser();

        await expect(rx.getPatientPrescription(b.son.id, b.id)).resolves.toMatchObject({ consultationId: b.id });
        await expect(rx.getPatientPrescription(b.mother.id, b.id)).rejects.toMatchObject({ status: 404 });
        await family.acceptFamilyLink(b.mother.id, b.patient.id);
        await expect(rx.getPatientPrescription(b.mother.id, b.id)).resolves.toMatchObject({ consultationId: b.id });
        await expect(rx.getPatientPrescription(stranger.id, b.id)).rejects.toMatchObject({ status: 404 });
    });

    it('guest link: early, then open, joins as the patient; the booker joins as the caregiver', async () => {
        const b = await familyBooking(30);
        const { guestToken, startsAt } = await testDb.consultation.findUniqueOrThrow({ where: { id: b.id } });

        const early = await room.guestInfo(guestToken!, new Date(startsAt.getTime() - 20 * 60_000));
        expect(early).toMatchObject({ window: 'early', patientFirstName: 'Sunita', language: 'hi', doctor: { name: 'Dr Test' } });
        expect(early).not.toHaveProperty('chronicConditions');

        const now = new Date(startsAt.getTime() - 5 * 60_000);
        const guest = await room.guestJoin(guestToken!, { video, now });
        expect(guest.identity).toBe(`patient:${b.patient.id}`);
        const caregiver = await room.patientJoin(b.son.id, b.id, { video, now });
        expect(caregiver.identity).toBe(`caretaker:${b.son.id}`);
        expect(caregiver.role).toBe('caretaker');

        const c = await testDb.consultation.findUniqueOrThrow({ where: { id: b.id } });
        expect(c.familyJoinedAt).not.toBeNull();
        expect(c.caregiverJoinedAt).not.toBeNull();
        expect(c.status).toBe('WAITING');
    });

    it('guest link expires after the call window and stops working once cancelled', async () => {
        const b = await familyBooking(30);
        const { guestToken, startsAt } = await testDb.consultation.findUniqueOrThrow({ where: { id: b.id } });
        await expect(room.guestInfo(guestToken!, new Date(startsAt.getTime() + 60 * 60_000))).rejects.toMatchObject({ status: 410 });
        await testDb.consultation.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
        await expect(room.guestInfo(guestToken!, new Date(startsAt.getTime() - 5 * 60_000))).rejects.toMatchObject({ status: 410 });
        await expect(room.guestInfo(randomUUID())).rejects.toMatchObject({ status: 404 });
    });

    it('the family member must accept before joining from the app', async () => {
        const b = await familyBooking(30);
        const { startsAt } = await testDb.consultation.findUniqueOrThrow({ where: { id: b.id } });
        const now = new Date(startsAt.getTime() - 5 * 60_000);
        await expect(room.patientJoin(b.mother.id, b.id, { video, now })).rejects.toMatchObject({ status: 409 });
        await family.acceptFamilyLink(b.mother.id, b.patient.id);
        expect((await room.patientJoin(b.mother.id, b.id, { video, now })).identity).toBe(`patient:${b.patient.id}`);
    });
});
