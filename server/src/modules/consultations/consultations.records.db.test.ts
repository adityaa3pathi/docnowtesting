/**
 * P7: the patient's health record shared with the booking's doctor (real Postgres).
 * Rules (Aditya, 2026-11-23): opt-in per booking; the doctor of a paid booking sees everything
 * (lab reports, every past consultation, vault files) until 7 days after the visit; every view and
 * every file opened is logged; nobody else sees it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { consistencyViolations, describeDb, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { FakeRazorpay } from './test/fakeRazorpay';
import { serve, tokenFor, useTestJwtSecret } from './test/http';
import type { AttachmentStorage } from './consultations.attachments';

useTestJwtSecret();

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(40, 2)]);
const DAY = 24 * 3_600_000;

function fakeStorage() {
    return {
        put: vi.fn(async (_key: string, _body: Buffer, _type: string) => {}),
        remove: vi.fn(async (_key: string) => {}),
        signedUrl: vi.fn(async (key: string, seconds: number) => `https://files.test/${key}?ttl=${seconds}`),
    } satisfies AttachmentStorage;
}

describeDb('shared health record (real Postgres)', () => {
    let booking: typeof import('./consultations.booking');
    let payments: typeof import('./consultations.payments');
    let records: typeof import('./consultations.records');
    let reschedule: typeof import('./consultations.reschedule');
    let razorpay: FakeRazorpay;
    let patientApp: { url: string; close: () => Promise<void> };
    let doctorApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        booking = await import('./consultations.booking');
        payments = await import('./consultations.payments');
        records = await import('./consultations.records');
        reschedule = await import('./consultations.reschedule');
        const routes = await import('./doctors.routes');
        const patientRoutes = await import('./consultations.routes');
        patientApp = await serve('/consult', patientRoutes.consultPatientRoutes);
        doctorApp = await serve('/doctor', routes.doctorRoutes);
    });
    afterAll(async () => {
        await Promise.all([patientApp?.close(), doctorApp?.close()]);
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        razorpay = new FakeRazorpay();
    });
    afterEach(async () => {
        expect(await consistencyViolations()).toEqual([]);
    });

    let n = 0;
    async function book(opts: { shareRecord?: boolean; user?: { id: string }; patient?: { id: string }; doctor?: Awaited<ReturnType<typeof makeDoctor>>; minutesAhead?: number } = {}) {
        const doctor = opts.doctor ?? (await makeDoctor());
        const user = opts.user ?? (await makeUser());
        const patient = opts.patient ?? (await makePatient(user.id));
        const slot = await makeSlot(doctor.profile.id, opts.minutesAhead ?? 30 * 60);
        const res = await booking.createBooking(
            { userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: `key-rec-${++n}-12345`, shareRecord: opts.shareRecord, shareMeta: { channel: 'web', ipAddress: '10.0.0.1', userAgent: 'vitest' } },
            { razorpay },
        );
        return { doctor, user, patient, slot, id: res.consultationId, orderId: res.razorpayOrderId!, fee: res.amountPaise };
    }
    const pay = (b: { orderId: string; fee: number }) =>
        payments.confirmPayment({ paymentId: `pay_rec${String(++n).padStart(9, '0')}`, orderId: b.orderId, amountPaise: b.fee, currency: 'INR' });
    async function paidShared(extra: Parameters<typeof book>[0] = {}) {
        const b = await book({ shareRecord: true, ...extra });
        await pay(b);
        return b;
    }

    /** A finished consultation with another doctor: notes, a prescription and an attached file. */
    async function pastVisit(user: { id: string }, patient: { id: string }) {
        const other = await makeDoctor();
        const slot = await makeSlot(other.profile.id, -3 * 24 * 60, 'BOOKED');
        const c = await testDb.consultation.create({
            data: {
                userId: user.id, patientId: patient.id, doctorId: other.profile.id, slotId: slot.id, startsAt: slot.startsAt,
                status: 'COMPLETED', endedAt: slot.endsAt, feePaise: 50000, platformFeePaise: 5000, policyId: 'default-consult-policy-v1', policySnapshot: {},
                holdExpiresAt: slot.startsAt, idempotencyKey: randomUUID(), requestHash: 'h', orderReceipt: `rcpt_${randomUUID().slice(0, 20)}`,
                note: { create: { complaints: 'Cough for a week', diagnosis: 'Bronchitis', advice: 'Steam' } },
                prescriptions: { create: { version: 1, medicines: [{ name: 'Azithromycin' }], recommendedTests: [], advice: 'Rest', doctorSnapshot: {}, patientSnapshot: {} } },
                attachments: { create: { userId: user.id, storageKey: `att/${randomUUID()}.jpg`, name: 'xray.jpg', mimeType: 'image/jpeg', sizeBytes: 10 } },
            },
            include: { attachments: true },
        });
        return { consultation: c, attachment: c.attachments[0] };
    }
    async function labReport(userId: string, patientId: string, vendorCustomerId = patientId) {
        const b = await testDb.booking.create({
            data: { userId, status: 'COMPLETED', slotDate: '2026-11-01', slotTime: '08:00', totalAmount: 500, items: { create: { patientId, testCode: 'T1', testName: 'CBC', price: 500 } } },
        });
        return testDb.report.create({ data: { bookingId: b.id, vendorCustomerId, sourceUrl: 'https://example.test/r.pdf', isFullReport: true } });
    }
    async function vaultFile(userId: string, patientId: string, name = 'old-rx.pdf') {
        return testDb.patientDocument.create({ data: { userId, patientId, storageKey: `records/${userId}/${randomUUID()}.pdf`, name, mimeType: 'application/pdf', sizeBytes: 100 } });
    }
    async function cancelled(b: { id: string; slot: { id: string } }) {
        await testDb.consultation.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
        await testDb.slot.update({ where: { id: b.slot.id }, data: { status: 'AVAILABLE' } });
    }
    const accessRows = (consultationId: string) => testDb.healthRecordAccess.findMany({ where: { consultationId }, orderBy: { createdAt: 'asc' } });
    const asStaff = (u: { id: string }) => testDb.user.findUniqueOrThrow({ where: { id: u.id } });

    describe('consent at booking', () => {
        it('the ticked box stores the consent with its wording version; unticked stores nothing', async () => {
            const shared = await book({ shareRecord: true });
            const plain = await book();
            const c = await testDb.consultation.findUniqueOrThrow({ where: { id: shared.id }, include: { recordShareConsents: true } });
            expect(c.recordSharedAt).not.toBeNull();
            expect(c.recordShareConsents).toHaveLength(1);
            expect(c.recordShareConsents[0]).toMatchObject({ granted: true, version: records.RECORD_SHARE_VERSION, channel: 'web', ipAddress: '10.0.0.1', userAgent: 'vitest', userId: shared.user.id });
            const p = await testDb.consultation.findUniqueOrThrow({ where: { id: plain.id }, include: { recordShareConsents: true } });
            expect(p.recordSharedAt).toBeNull();
            expect(p.recordShareConsents).toHaveLength(0);
        });

        it('a repeated booking call with another choice updates sharing, without a new booking', async () => {
            const b = await book();
            const again = await booking.createBooking(
                { userId: b.user.id, patientId: b.patient.id, slotId: b.slot.id, idempotencyKey: `key-rec-${n}-12345`, shareRecord: true },
                { razorpay },
            );
            expect(again.consultationId).toBe(b.id);
            expect((await testDb.consultation.findUniqueOrThrow({ where: { id: b.id } })).recordSharedAt).not.toBeNull();
            expect(await testDb.consultation.count({ where: { userId: b.user.id } })).toBe(1);
        });
    });

    describe('what the doctor sees', () => {
        it('nothing before payment: the hold does not open the record', async () => {
            const b = await book({ shareRecord: true });
            const out = await records.getSharedRecord(b.doctor.profile.id, b.id);
            expect(out).toMatchObject({ shared: false, reason: 'NOT_ACTIVE' });
            expect(await accessRows(b.id)).toHaveLength(0);
        });

        it('after payment: every lab report, past consultation (other doctors too) and vault file of this person, and a log row', async () => {
            const b = await book({ shareRecord: true });
            const sibling = await makePatient(b.user.id);
            const stranger = await makeUser();
            const strangerPatient = await makePatient(stranger.id);
            const own = await labReport(b.user.id, b.patient.id);
            const legacy = await labReport(b.user.id, b.patient.id, '');
            await labReport(b.user.id, sibling.id); // another family member's
            await labReport(stranger.id, strangerPatient.id); // another account's
            const past = await pastVisit(b.user, b.patient);
            await pastVisit(b.user, sibling);
            const file = await vaultFile(b.user.id, b.patient.id);
            await vaultFile(b.user.id, sibling.id, 'sibling.pdf');
            await pay(b);

            const out = await records.getSharedRecord(b.doctor.profile.id, b.id, { ipAddress: '10.9.9.9' });
            if (!out.shared) throw new Error('expected the record to be shared');
            expect(out.reports.map((r) => r.id).sort()).toEqual([own.id, legacy.id].sort());
            expect(out.reports[0]).toMatchObject({ label: 'CBC', isFullReport: true });
            expect(out.consultations).toHaveLength(1);
            expect(out.consultations[0]).toMatchObject({
                id: past.consultation.id, doctorName: 'Dr Test',
                note: { complaints: 'Cough for a week', diagnosis: 'Bronchitis' },
                prescription: { advice: 'Rest' },
                attachments: [{ id: past.attachment.id, name: 'xray.jpg' }],
            });
            expect(out.consultations.map((c) => c.id)).not.toContain(b.id);
            expect(out.documents.map((d) => d.id)).toEqual([file.id]);
            // Files are listed without links: each open goes through openSharedFile and is logged.
            expect(JSON.stringify(out)).not.toMatch(/storageKey|https?:\/\//);
            expect(await accessRows(b.id)).toEqual([expect.objectContaining({ action: 'RECORD', doctorId: b.doctor.profile.id, patientId: b.patient.id, ipAddress: '10.9.9.9' })]);
        });

        it('without the tick the doctor gets "not shared", cannot open anything, and nothing is logged', async () => {
            const b = await book();
            await pay(b);
            const file = await vaultFile(b.user.id, b.patient.id);
            expect(await records.getSharedRecord(b.doctor.profile.id, b.id)).toMatchObject({ shared: false, reason: 'NOT_SHARED' });
            await expect(records.openSharedFile(b.doctor.profile.id, b.id, 'document', file.id, {}, { storage: fakeStorage() })).rejects.toMatchObject({ status: 403 });
            expect(await accessRows(b.id)).toHaveLength(0);
        });

        it('access lasts until 7 days after the visit ends, then closes', async () => {
            const b = await paidShared();
            const endedAt = new Date(Date.now() - DAY);
            await testDb.consultation.update({ where: { id: b.id }, data: { status: 'COMPLETED', startedAt: new Date(endedAt.getTime() - 600_000), endedAt } });
            const justIn = () => new Date(endedAt.getTime() + 7 * DAY - 60_000);
            const justOut = () => new Date(endedAt.getTime() + 7 * DAY + 60_000);
            expect(await records.getSharedRecord(b.doctor.profile.id, b.id, {}, { now: justIn })).toMatchObject({ shared: true });
            expect(await records.getSharedRecord(b.doctor.profile.id, b.id, {}, { now: justOut })).toMatchObject({ shared: false, reason: 'ENDED' });
            const report = await labReport(b.user.id, b.patient.id);
            await expect(records.openSharedFile(b.doctor.profile.id, b.id, 'report', report.id, {}, { now: justOut })).rejects.toMatchObject({ status: 403, message: 'Access to this health record has ended' });
        });

        it('a cancelled booking closes the record', async () => {
            const b = await paidShared();
            await cancelled(b);
            expect(await records.getSharedRecord(b.doctor.profile.id, b.id)).toMatchObject({ shared: false, reason: 'NOT_ACTIVE' });
        });

        it('opening a file checks it belongs to this person, logs each open, and hands a 10-minute link', async () => {
            const b = await paidShared();
            const storage = fakeStorage();
            const file = await vaultFile(b.user.id, b.patient.id);
            const past = await pastVisit(b.user, b.patient);
            const report = await labReport(b.user.id, b.patient.id);
            const sibling = await makePatient(b.user.id);
            const siblingFile = await vaultFile(b.user.id, sibling.id);
            const siblingReport = await labReport(b.user.id, sibling.id);
            const siblingVisit = await pastVisit(b.user, sibling);
            const doc = b.doctor.profile.id;

            expect(await records.openSharedFile(doc, b.id, 'document', file.id, { ipAddress: '1.2.3.4' }, { storage })).toMatchObject({ kind: 'document', name: 'old-rx.pdf', url: expect.stringContaining('ttl=600') });
            expect(await records.openSharedFile(doc, b.id, 'attachment', past.attachment.id, {}, { storage })).toMatchObject({ kind: 'attachment', name: 'xray.jpg' });
            const r = await records.openSharedFile(doc, b.id, 'report', report.id);
            expect(r).toMatchObject({ kind: 'report', viewToken: expect.any(String) });
            const { verifyReportAccessToken } = await import('../../services/reportAccess');
            const payload = verifyReportAccessToken((r as { viewToken: string }).viewToken) as { exp: number };
            expect(payload.exp - Date.now()).toBeLessThanOrEqual(10 * 60_000);

            for (const [kind, id] of [['document', siblingFile.id], ['report', siblingReport.id], ['attachment', siblingVisit.attachment.id]] as const) {
                await expect(records.openSharedFile(doc, b.id, kind, id, {}, { storage })).rejects.toMatchObject({ status: 404 });
            }
            const rows = await accessRows(b.id);
            expect(rows.map((x) => [x.action, x.targetId])).toEqual([['DOCUMENT', file.id], ['ATTACHMENT', past.attachment.id], ['REPORT', report.id]]);
            expect(rows[0].ipAddress).toBe('1.2.3.4');
        });

        it('another doctor gets 404 through the route, and so does a patient', async () => {
            const b = await paidShared();
            const other = await makeDoctor();
            const report = await labReport(b.user.id, b.patient.id);
            const asOther = tokenFor(await asStaff(other.user));
            const own = tokenFor(await asStaff(b.doctor.user));
            const get = (path: string, token: string) => fetch(`${doctorApp.url}/doctor${path}`, { headers: { authorization: `Bearer ${token}` } });

            expect((await get(`/me/consultations/${b.id}/record`, asOther)).status).toBe(404);
            expect((await get(`/me/consultations/${b.id}/record/reports/${report.id}`, asOther)).status).toBe(404);
            expect((await get(`/me/consultations/${b.id}/record`, tokenFor(await asStaff(b.user)))).status).toBe(403);
            const mine = await get(`/me/consultations/${b.id}/record`, own);
            expect(mine.status).toBe(200);
            expect(await mine.json()).toMatchObject({ shared: true, reports: [{ id: report.id }] });
            expect((await get(`/me/consultations/${b.id}/record/reports/${report.id}`, own)).status).toBe(200);
            expect((await get(`/me/consultations/${b.id}/record/bogus/${report.id}`, own)).status).toBe(404);
            expect((await accessRows(b.id)).map((r) => r.action)).toEqual(['RECORD', 'REPORT']);
        });
    });

    describe('switching sharing on the booking page', () => {
        it('the booker switches it off: the doctor loses access at once; both switches are kept', async () => {
            const b = await paidShared();
            const view = await records.setRecordSharing(b.user.id, b.id, false, { channel: 'web' });
            expect(view).toMatchObject({ shared: false, canShare: true });
            expect(await records.getSharedRecord(b.doctor.profile.id, b.id)).toMatchObject({ shared: false, reason: 'NOT_SHARED' });
            const consents = await testDb.recordShareConsent.findMany({ where: { consultationId: b.id }, orderBy: { createdAt: 'asc' } });
            expect(consents.map((c) => c.granted)).toEqual([true, false]);
            // Same choice again: no extra row.
            await records.setRecordSharing(b.user.id, b.id, false, {});
            expect(await testDb.recordShareConsent.count({ where: { consultationId: b.id } })).toBe(2);
        });

        it('two taps at once leave a single consent row', async () => {
            const b = await book();
            await pay(b);
            await Promise.all([1, 2, 3].map(() => records.setRecordSharing(b.user.id, b.id, true, {})));
            expect(await testDb.recordShareConsent.count({ where: { consultationId: b.id } })).toBe(1);
        });

        it('the accepted family member may switch it; a stranger or a not-yet-accepted number may not', async () => {
            const booker = await makeUser();
            const mum = await testDb.user.create({ data: { mobile: `6${String(Date.now()).slice(-9)}`, name: 'Mum' } });
            const person = await testDb.patient.create({ data: { userId: booker.id, name: 'Mum', relation: 'Mother', age: 60, gender: 'F', phone: mum.mobile } });
            const b = await book({ user: booker, patient: person });
            await pay(b);
            const stranger = await makeUser();
            await expect(records.setRecordSharing(stranger.id, b.id, true, {})).rejects.toMatchObject({ status: 404 });
            await expect(records.setRecordSharing(mum.id, b.id, true, {})).rejects.toMatchObject({ status: 404 });
            await testDb.patient.update({ where: { id: person.id }, data: { linkedUserId: mum.id, linkedAt: new Date() } });
            expect(await records.setRecordSharing(mum.id, b.id, true, {})).toMatchObject({ shared: true });
            expect(await testDb.recordShareConsent.findFirst({ where: { consultationId: b.id } })).toMatchObject({ userId: mum.id, granted: true });
        });

        it('cannot be switched on once the booking was cancelled, but stays switchable off', async () => {
            const b = await paidShared();
            await cancelled(b);
            expect(await records.setRecordSharing(b.user.id, b.id, false, {})).toMatchObject({ shared: false, canShare: false });
            await expect(records.setRecordSharing(b.user.id, b.id, true, {})).rejects.toMatchObject({ status: 409 });
        });

        it('the booking detail shows the state and when the doctor last opened the record; the route works with a token', async () => {
            const b = await paidShared();
            expect((await booking.getBooking(b.user.id, b.id)).recordSharing).toMatchObject({ shared: true, lastViewedAt: null });
            await records.getSharedRecord(b.doctor.profile.id, b.id);
            const detail = await booking.getBooking(b.user.id, b.id);
            expect(detail.recordSharing?.lastViewedAt).toBeInstanceOf(Date);

            const token = tokenFor(await asStaff(b.user));
            const put = (id: string, body: unknown, t = token) => fetch(`${patientApp.url}/consult/bookings/${id}/record-sharing`, {
                method: 'PUT', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
            });
            const off = await put(b.id, { share: false, consentVersion: 'record-share-v1', channel: 'app' });
            expect(off.status).toBe(200);
            expect(await off.json()).toMatchObject({ shared: false });
            expect(await testDb.recordShareConsent.findFirst({ where: { consultationId: b.id, granted: false } })).toMatchObject({ channel: 'app' });
            expect((await put(b.id, { share: 'yes' })).status).toBe(400);
            expect((await put(b.id, { share: true }, tokenFor(await asStaff(await makeUser())))).status).toBe(404);
        });
    });

    describe('medical records vault', () => {
        it('the owner uploads, lists and deletes files per person; storage is cleaned up', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const storage = fakeStorage();
            const up = await records.uploadDocument(user.id, self.id, { buffer: PDF, originalname: 'discharge summary.pdf' }, { storage });
            expect(up).toMatchObject({ name: 'discharge summary.pdf', mimeType: 'application/pdf', patientId: self.id, url: expect.stringContaining('records/') });
            expect(up).not.toHaveProperty('storageKey');
            await records.uploadDocument(user.id, self.id, { buffer: JPEG, originalname: 'rx.png' }, { storage });
            const list = await records.listDocuments(user.id, self.id, { storage });
            expect(list.documents.map((d) => d.name)).toEqual(['rx.jpg', 'discharge summary.pdf']);

            await records.removeDocument(user.id, up.id, { storage });
            expect(storage.remove).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
            expect((await records.listDocuments(user.id, self.id, { storage })).documents).toHaveLength(1);
        });

        it('another account cannot list, add to or delete someone\'s files', async () => {
            const owner = await makeUser();
            const self = await makePatient(owner.id);
            const other = await makeUser();
            const storage = fakeStorage();
            const doc = await records.uploadDocument(owner.id, self.id, { buffer: PDF }, { storage });
            await expect(records.listDocuments(other.id, self.id, { storage })).rejects.toMatchObject({ status: 404 });
            await expect(records.uploadDocument(other.id, self.id, { buffer: PDF }, { storage })).rejects.toMatchObject({ status: 404 });
            await expect(records.removeDocument(other.id, doc.id, { storage })).rejects.toMatchObject({ status: 404 });
            expect(storage.put).toHaveBeenCalledTimes(1);
            const res = await fetch(`${patientApp.url}/consult/records/${self.id}/documents`, { headers: { authorization: `Bearer ${tokenFor(await asStaff(other))}` } });
            expect(res.status).toBe(404);
        });

        it('refuses non-medical file types and more than the per-person limit', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const storage = fakeStorage();
            await expect(records.uploadDocument(user.id, self.id, { buffer: Buffer.from('just some text, not a scan or a photo') }, { storage })).rejects.toMatchObject({ status: 415 });
            await testDb.patientDocument.createMany({
                data: Array.from({ length: records.MAX_DOCUMENTS_PER_PERSON }, () => ({ userId: user.id, patientId: self.id, storageKey: `records/${randomUUID()}.pdf`, name: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1 })),
            });
            await expect(records.uploadDocument(user.id, self.id, { buffer: PDF }, { storage })).rejects.toMatchObject({ status: 409 });
            expect(storage.put).not.toHaveBeenCalled();
        });

        it('a deleted file disappears from the doctor\'s view at once', async () => {
            const b = await paidShared();
            const storage = fakeStorage();
            const doc = await records.uploadDocument(b.user.id, b.patient.id, { buffer: PDF }, { storage });
            await records.removeDocument(b.user.id, doc.id, { storage });
            const out = await records.getSharedRecord(b.doctor.profile.id, b.id);
            expect(out.shared && out.documents).toEqual([]);
            await expect(records.openSharedFile(b.doctor.profile.id, b.id, 'document', doc.id, {}, { storage })).rejects.toMatchObject({ status: 404 });
        });

        it('account deletion removes the vault files and their storage', async () => {
            const { deleteAccount } = await import('../../services/accountDeletion');
            const user = await makeUser();
            const self = await makePatient(user.id);
            const storage = fakeStorage();
            const doc = await records.uploadDocument(user.id, self.id, { buffer: PDF }, { storage });
            await deleteAccount(user.id, { storage });
            expect(await testDb.patientDocument.count({ where: { userId: user.id } })).toBe(0);
            expect(storage.remove).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
            expect(doc.id).toBeTruthy();
        });
    });
    describe('review fixes', () => {
        it('a move to another doctor (late-doctor reassign) ends sharing; the new doctor sees nothing', async () => {
            const b = await paidShared({ minutesAhead: 60 });
            const other = await makeDoctor();
            const soon = await makeSlot(other.profile.id, 70);
            const now = () => new Date(b.slot.startsAt.getTime() + 6 * 60_000);
            await reschedule.reassignBooking(b.user.id, b.id, soon.id, { now });
            expect((await testDb.consultation.findUniqueOrThrow({ where: { id: b.id } })).recordSharedAt).toBeNull();
            expect(await testDb.recordShareConsent.findFirst({ where: { consultationId: b.id, granted: false } })).toMatchObject({ channel: 'system', userId: null });
            expect(await records.getSharedRecord(other.profile.id, b.id)).toMatchObject({ shared: false, reason: 'NOT_SHARED' });
        });

        it('a move to another time with the same doctor keeps sharing', async () => {
            const b = await paidShared({ minutesAhead: 60 });
            const later = await makeSlot(b.doctor.profile.id, 60 + 24 * 60);
            await reschedule.rescheduleBooking(b.user.id, b.id, later.id, { now: () => new Date(b.slot.startsAt.getTime() + 6 * 60_000) });
            expect(await records.getSharedRecord(b.doctor.profile.id, b.id)).toMatchObject({ shared: true });
        });

        it('a lab report with no customer id from a booking for two people is never shown or opened', async () => {
            const b = await book({ shareRecord: true });
            const dad = await makePatient(b.user.id);
            const lab = await testDb.booking.create({
                data: { userId: b.user.id, status: 'COMPLETED', slotDate: '2026-11-01', slotTime: '08:00', totalAmount: 1000,
                    items: { create: [{ patientId: b.patient.id, testCode: 'T1', testName: 'CBC', price: 500 }, { patientId: dad.id, testCode: 'T2', testName: 'Lipid', price: 500 }] } },
            });
            const shared = await testDb.report.create({ data: { bookingId: lab.id, vendorCustomerId: '', sourceUrl: 'https://example.test/r.pdf' } });
            await pay(b);
            const out = await records.getSharedRecord(b.doctor.profile.id, b.id);
            expect(out.shared && out.reports).toEqual([]);
            await expect(records.openSharedFile(b.doctor.profile.id, b.id, 'report', shared.id)).rejects.toMatchObject({ status: 404 });
        });

        it('repeating a paid booking call never changes sharing; repeating after the hold ended never switches it on', async () => {
            const user = await makeUser();
            await testDb.wallet.create({ data: { userId: user.id, balance: 1000 } });
            const doctor = await makeDoctor();
            const patient = await makePatient(user.id);
            const slot = await makeSlot(doctor.profile.id, 30 * 60);
            const input = { userId: user.id, patientId: patient.id, slotId: slot.id, idempotencyKey: 'key-rec-wallet-1234', useWallet: true };
            const first = await booking.createBooking({ ...input, shareRecord: false }, { razorpay });
            expect(first.status).toBe('CONFIRMED');
            await records.setRecordSharing(user.id, first.consultationId, true, {});
            await booking.createBooking({ ...input, shareRecord: false }, { razorpay });
            expect((await testDb.consultation.findUniqueOrThrow({ where: { id: first.consultationId } })).recordSharedAt).not.toBeNull();

            const held = await book();
            await testDb.consultation.update({ where: { id: held.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
            await booking.createBooking({ userId: held.user.id, patientId: held.patient.id, slotId: held.slot.id, idempotencyKey: `key-rec-${n}-12345`, shareRecord: true }, { razorpay }).catch(() => {});
            expect((await testDb.consultation.findUniqueOrThrow({ where: { id: held.id } })).recordSharedAt).toBeNull();
        });

        it('deleting the account ends sharing at once, even inside the 7-day window', async () => {
            const { deleteAccount } = await import('../../services/accountDeletion');
            const b = await paidShared();
            await testDb.consultation.update({ where: { id: b.id }, data: { status: 'COMPLETED', startedAt: new Date(Date.now() - 3_600_000), endedAt: new Date(Date.now() - 1_800_000) } });
            await deleteAccount(b.user.id, { storage: fakeStorage() });
            expect(await records.getSharedRecord(b.doctor.profile.id, b.id)).toMatchObject({ shared: false, reason: 'NOT_SHARED' });
            expect(await testDb.recordShareConsent.findFirst({ where: { consultationId: b.id, granted: false } })).toMatchObject({ channel: 'system' });
        });

        it('an attachment of a cancelled or upcoming booking is not part of the record', async () => {
            const b = await paidShared();
            const other = await book({ user: b.user, patient: b.patient });
            const att = await testDb.consultationAttachment.create({ data: { userId: b.user.id, consultationId: other.id, storageKey: `att/${randomUUID()}.jpg`, name: 'private.jpg', mimeType: 'image/jpeg', sizeBytes: 5 } });
            await expect(records.openSharedFile(b.doctor.profile.id, b.id, 'attachment', att.id, {}, { storage: fakeStorage() })).rejects.toMatchObject({ status: 404 });
            await cancelled(other);
            await expect(records.openSharedFile(b.doctor.profile.id, b.id, 'attachment', att.id, {}, { storage: fakeStorage() })).rejects.toMatchObject({ status: 404 });
            // This booking's own attachment still opens.
            const own = await testDb.consultationAttachment.create({ data: { userId: b.user.id, consultationId: b.id, storageKey: `att/${randomUUID()}.jpg`, name: 'own.jpg', mimeType: 'image/jpeg', sizeBytes: 5 } });
            expect(await records.openSharedFile(b.doctor.profile.id, b.id, 'attachment', own.id, {}, { storage: fakeStorage() })).toMatchObject({ name: 'own.jpg' });
        });

        it('cannot be switched on after the 7-day window', async () => {
            const b = await book();
            await pay(b);
            const endedAt = new Date(Date.now() - 30 * DAY);
            await testDb.consultation.update({ where: { id: b.id }, data: { status: 'COMPLETED', startedAt: endedAt, endedAt } });
            await expect(records.setRecordSharing(b.user.id, b.id, true, {})).rejects.toMatchObject({ status: 409 });
            expect(await testDb.recordShareConsent.count({ where: { consultationId: b.id } })).toBe(0);
        });

        it('parallel uploads cannot pass the per-person limit', async () => {
            const user = await makeUser();
            const self = await makePatient(user.id);
            const storage = fakeStorage();
            await testDb.patientDocument.createMany({
                data: Array.from({ length: records.MAX_DOCUMENTS_PER_PERSON - 1 }, () => ({ userId: user.id, patientId: self.id, storageKey: `records/${randomUUID()}.pdf`, name: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1 })),
            });
            const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => records.uploadDocument(user.id, self.id, { buffer: PDF }, { storage })));
            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            expect(await testDb.patientDocument.count({ where: { patientId: self.id } })).toBe(records.MAX_DOCUMENTS_PER_PERSON);
            // Refused uploads leave no file behind (some are refused before storing anything).
            expect(storage.remove).toHaveBeenCalledTimes(storage.put.mock.calls.length - 1);
            const kept = await testDb.patientDocument.findFirstOrThrow({ where: { patientId: self.id, storageKey: { in: storage.put.mock.calls.map((c) => c[0] as string) } } });
            const removed = storage.remove.mock.calls.map((c) => c[0] as string);
            expect(removed).not.toContain(kept.storageKey);
            expect(new Set([...removed, kept.storageKey])).toEqual(new Set(storage.put.mock.calls.map((c) => c[0] as string)));
        });
    });
});
