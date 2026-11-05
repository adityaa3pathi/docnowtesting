/**
 * Outside medical records on consultations. Unit tests use a fake database and storage; the
 * suite at the end needs TEST_DATABASE_URL (real Postgres) and is skipped without it.
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    attachmentsFor,
    claimAttachments,
    cleanFileName,
    MAX_ATTACHMENT_BYTES,
    removeAttachment,
    sniffType,
    uploadAttachment,
    type AttachmentStorage,
    type AttachmentView,
} from './consultations.attachments';
import { getBooking } from './consultations.booking';
import { suggestCollectionAddress } from './consultations.prescription';
import { describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { useTestJwtSecret } from './test/http';

useTestJwtSecret();

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(60, 1)]);
const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(60, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(60, 1)]);

/** Booking views are a union (booker, family, not yet accepted); only some carry documents. */
const docsOf = (v: object): AttachmentView[] | undefined => ('attachments' in v ? (v as { attachments: AttachmentView[] }).attachments : undefined);

function fakeStorage(): AttachmentStorage & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
    return {
        put: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        signedUrl: vi.fn(async (key: string, seconds: number) => `https://s3.test/${key}?expires=${seconds}`),
    };
}

describe('file checks', () => {
    it('reads the real type from the bytes', () => {
        expect(sniffType(JPEG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
        expect(sniffType(PNG)?.mime).toBe('image/png');
        expect(sniffType(WEBP)?.mime).toBe('image/webp');
        expect(sniffType(HEIC)?.mime).toBe('image/heic');
        expect(sniffType(PDF)?.mime).toBe('application/pdf');
    });

    it('refuses anything that is not a photo or PDF, whatever it is called', () => {
        expect(sniffType(Buffer.from('MZ\x90\x00 this is an exe pretending to be a jpg'))).toBeNull();
        expect(sniffType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
        expect(sniffType(Buffer.from([0xff, 0xd8]))).toBeNull();
    });

    it('keeps a clean display name with the real extension', () => {
        expect(cleanFileName('../../etc/discharge summary.png', 'jpg')).toBe('discharge summary.jpg');
        expect(cleanFileName(undefined, 'pdf')).toBe('medical-record.pdf');
        expect(cleanFileName('IMG_2041.HEIC', 'heic')).toBe('IMG_2041.heic');
    });
});

describe('uploading', () => {
    const db = () => ({ consultationAttachment: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, createdAt: new Date('2026-11-01T10:00:00Z') })) } });

    it('stores privately under the user, with the sniffed type, and returns a signed link', async () => {
        const storage = fakeStorage();
        const d = db();
        const out = await uploadAttachment('user-1', { buffer: JPEG, originalname: 'old prescription.png' }, { db: d as never, storage });

        const key = storage.put.mock.calls[0]?.[0] as string;
        expect(key).toMatch(/^user-1\/[0-9a-f-]{36}\.jpg$/);
        expect(storage.put).toHaveBeenCalledWith(key, JPEG, 'image/jpeg');
        expect(d.consultationAttachment.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ userId: 'user-1', storageKey: key, name: 'old prescription.jpg', mimeType: 'image/jpeg', sizeBytes: JPEG.length }),
        });
        expect(out).toMatchObject({ name: 'old prescription.jpg', mimeType: 'image/jpeg', url: `https://s3.test/${key}?expires=3600` });
        expect(out).not.toHaveProperty('storageKey');
    });

    it('refuses empty, oversized and wrong-type files before storing anything', async () => {
        const storage = fakeStorage();
        await expect(uploadAttachment('u', { buffer: Buffer.alloc(0) }, { db: db() as never, storage })).rejects.toMatchObject({ status: 400 });
        await expect(uploadAttachment('u', { buffer: Buffer.concat([JPEG, Buffer.alloc(MAX_ATTACHMENT_BYTES)]) }, { db: db() as never, storage })).rejects.toMatchObject({ status: 413 });
        await expect(uploadAttachment('u', { buffer: Buffer.from('plain text file, not a scan at all') }, { db: db() as never, storage })).rejects.toMatchObject({ status: 415 });
        expect(storage.put).not.toHaveBeenCalled();
    });

    it('lets the uploader remove only their own unclaimed file', async () => {
        const storage = fakeStorage();
        const found = { consultationAttachment: { findFirst: vi.fn().mockResolvedValue({ id: 'a1', storageKey: 'user-1/a1.jpg' }), delete: vi.fn() } };
        await removeAttachment('user-1', 'a1', { db: found as never, storage });
        expect(found.consultationAttachment.findFirst).toHaveBeenCalledWith({ where: { id: 'a1', userId: 'user-1', consultationId: null } });
        expect(storage.remove).toHaveBeenCalledWith('user-1/a1.jpg');

        const missing = { consultationAttachment: { findFirst: vi.fn().mockResolvedValue(null), delete: vi.fn() } };
        await expect(removeAttachment('user-2', 'a1', { db: missing as never, storage })).rejects.toMatchObject({ status: 404 });
    });
});

describe('claiming on booking', () => {
    const NOW = new Date('2026-11-01T12:00:00Z');
    const tx = (count: number) => ({ consultationAttachment: { updateMany: vi.fn().mockResolvedValue({ count }) } });

    it("links the booker's own fresh, unclaimed uploads to the new consultation", async () => {
        const t = tx(2);
        expect(await claimAttachments(t as never, 'user-1', 'c-1', ['a1', 'a2', 'a1'], NOW)).toBe(2);
        expect(t.consultationAttachment.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['a1', 'a2'] }, userId: 'user-1', consultationId: null, createdAt: { gt: new Date('2026-10-31T12:00:00Z') } },
            data: { consultationId: 'c-1' },
        });
    });

    it("fails the booking if any id is someone else's, old or already used", async () => {
        await expect(claimAttachments(tx(1) as never, 'user-1', 'c-1', ['a1', 'a2'], NOW)).rejects.toMatchObject({ status: 409 });
        await expect(claimAttachments(tx(6) as never, 'user-1', 'c-1', ['1', '2', '3', '4', '5', '6'], NOW)).rejects.toMatchObject({ status: 400 });
    });

    it('does nothing without attachments', async () => {
        const t = tx(0);
        expect(await claimAttachments(t as never, 'user-1', 'c-1', [], NOW)).toBe(0);
        expect(t.consultationAttachment.updateMany).not.toHaveBeenCalled();
    });
});

describe('reading', () => {
    const row = { id: 'a1', name: 'discharge.pdf', mimeType: 'application/pdf', sizeBytes: 1234, createdAt: new Date('2026-11-01T10:00:00Z'), storageKey: 'user-1/a1.pdf' };

    it('returns documents with fresh signed links, and an empty list if storage is down', async () => {
        const db = { consultationAttachment: { findMany: vi.fn().mockResolvedValue([row]) } };
        expect(await attachmentsFor('c-1', { db: db as never, storage: fakeStorage() })).toEqual([
            { id: 'a1', name: 'discharge.pdf', mimeType: 'application/pdf', sizeBytes: 1234, uploadedAt: row.createdAt, url: 'https://s3.test/user-1/a1.pdf?expires=3600' },
        ]);
        const broken = { ...fakeStorage(), signedUrl: vi.fn().mockRejectedValue(new Error('S3 down')) };
        expect(await attachmentsFor('c-1', { db: db as never, storage: broken })).toEqual([]);
    });

    function bookingDb(patient: Record<string, unknown>, mobile: string | null) {
        const c = {
            id: 'c-1', userId: 'booker', patientId: 'p-1', doctorId: 'd-1', slotId: 's-1', status: 'CONFIRMED', type: 'VIDEO',
            startsAt: new Date('2026-11-02T10:00:00Z'), createdAt: new Date('2026-11-01T10:00:00Z'), holdExpiresAt: new Date('2026-11-01T10:10:00Z'),
            feePaise: 50000, policySnapshot: {}, doctorJoinedAt: null, patientJoinedAt: null, cancelReason: null, reviewReason: null,
            guestToken: 'g-1', isCaregiverJoined: true,
            doctor: { displayName: 'Sharma', photoUrl: null, qualification: 'MBBS', specialty: { name: 'GP' } },
            patient: { name: 'Sunita', relation: 'Parent', phone: '9876543210', linkedUserId: null, linkDeclinedAt: null, ...patient },
            user: { name: 'Aditya' }, slot: { endsAt: new Date('2026-11-02T10:15:00Z') },
            payments: [], refunds: [], prescriptions: [], note: null,
        };
        return {
            consultation: { findFirst: vi.fn().mockResolvedValue(c) },
            user: { findUnique: vi.fn().mockResolvedValue(mobile ? { mobile } : null) },
            consultationAttachment: { findMany: vi.fn().mockResolvedValue([row]) },
        };
    }

    it('includes the documents in the booking view for the booker and the accepted family member', async () => {
        const storage = fakeStorage();
        const booker = await getBooking('booker', 'c-1', bookingDb({}, null) as never, storage);
        expect(docsOf(booker)).toEqual([expect.objectContaining({ id: 'a1', name: 'discharge.pdf' })]);
        const family = await getBooking('mother', 'c-1', bookingDb({ linkedUserId: 'mother' }, '9876543210') as never, storage);
        expect(docsOf(family)).toEqual([expect.objectContaining({ id: 'a1' })]);
    });

    it('never shows them to a family member who has not accepted yet', async () => {
        const db = bookingDb({}, '9876543210');
        const pending = await getBooking('mother', 'c-1', db as never, fakeStorage());
        expect(pending).not.toHaveProperty('attachments');
        expect(db.consultationAttachment.findMany).not.toHaveBeenCalled();
    });
});

describe('collection address for "Book All Tests"', () => {
    const db = (forPatient: string | null, lastUsed: string | null, saved: string | null) => ({
        booking: { findFirst: vi.fn().mockResolvedValueOnce(forPatient ? { addressId: forPatient } : null).mockResolvedValueOnce(lastUsed ? { addressId: lastUsed } : null) },
        address: { findFirst: vi.fn().mockResolvedValue(saved ? { id: saved } : null) },
    });

    it("prefers the patient's own last collection address", async () => {
        const d = db('addr-mother', 'addr-son', 'addr-any');
        expect(await suggestCollectionAddress('booker', 'p-mother', d as never)).toBe('addr-mother');
        expect(d.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ userId: 'booker', items: { some: { patientId: 'p-mother' } }, address: { is: { isDeleted: false } } }),
        }));
    });

    it('falls back to the last used address, then any saved one, then none', async () => {
        expect(await suggestCollectionAddress('u', 'p', db(null, 'addr-last', 'addr-any') as never)).toBe('addr-last');
        expect(await suggestCollectionAddress('u', 'p', db(null, null, 'addr-any') as never)).toBe('addr-any');
        expect(await suggestCollectionAddress('u', 'p', db(null, null, null) as never)).toBeNull();
    });
});

// ── Integration: real Postgres ──────────────────────────

describeDb('consultation attachments (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let razorpay: FakeRazorpay;

    beforeAll(async () => {
        booking = await import('./consultations.booking');
    });
    afterAll(async () => {
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });

    let n = 0;
    const upload = (userId: string, name = 'old-prescription.jpg') =>
        testDb.consultationAttachment.create({ data: { userId, storageKey: `${userId}/${randomUUID()}.jpg`, name, mimeType: 'image/jpeg', sizeBytes: 2048 } });

    it('persists the uploads on the new consultation and returns them in the booking view', async () => {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, 60);
        const a = await upload(user.id, 'discharge-summary.jpg');
        const b = await upload(user.id, 'old-prescription.jpg');

        const res = await booking.createBooking(
            { userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-attach-${++n}-12345`, attachmentIds: [a.id, b.id] },
            { razorpay },
        );

        const linked = await testDb.consultationAttachment.findMany({ where: { consultationId: res.consultationId } });
        expect(linked.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());

        const view = await booking.getBooking(user.id, res.consultationId, undefined, fakeStorage());
        expect(docsOf(view)?.map((x) => x.name).sort()).toEqual(['discharge-summary.jpg', 'old-prescription.jpg']);
        expect(docsOf(view)?.[0]?.url).toMatch(/^https:\/\/s3\.test\//);
    });

    it("rejects someone else's upload and books nothing", async () => {
        const doctor = await makeDoctor();
        const user = await makeUser();
        const stranger = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(doctor.profile.id, 60);
        const theirs = await upload(stranger.id);

        await expect(
            booking.createBooking({ userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-attach-${++n}-12345`, attachmentIds: [theirs.id] }, { razorpay }),
        ).rejects.toMatchObject({ status: 409 });

        expect(await testDb.consultation.count({ where: { slotId: slot.id } })).toBe(0);
        expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('AVAILABLE');
        expect((await testDb.consultationAttachment.findUniqueOrThrow({ where: { id: theirs.id } })).consultationId).toBeNull();
    });
});
