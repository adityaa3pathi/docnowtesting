/**
 * P7 S2 (real Postgres): the super admin's view of one person's health record (every view and file
 * open audit-logged; super admins only), and the doctor's "Patients" screen (own patients, own visits).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { consistencyViolations, describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';
import type { AttachmentStorage } from './consultations.attachments';
import type { ConsultationStatus } from './consultations.types';

useTestJwtSecret();

function fakeStorage() {
    return {
        put: vi.fn(async (_key: string, _body: Buffer, _type: string) => {}),
        remove: vi.fn(async (_key: string) => {}),
        signedUrl: vi.fn(async (key: string, seconds: number) => `https://files.test/${key}?ttl=${seconds}`),
    } satisfies AttachmentStorage;
}

/** Statuses whose slot stays booked (the consistency check in afterEach). */
const HOLDS_SLOT: ConsultationStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR'];

describeDb('P7 S2: admin patient record and doctor patients (real Postgres)', () => {
    let admin: typeof import('./consultations.adminRecords');
    let patients: typeof import('./doctors.patients');
    let adminApp: { url: string; close: () => Promise<void> };
    let doctorApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        admin = await import('./consultations.adminRecords');
        patients = await import('./doctors.patients');
        const routes = await import('./doctors.routes');
        adminApp = await serve('/admin/consult', routes.consultAdminRoutes);
        doctorApp = await serve('/doctor', routes.doctorRoutes);
    });
    afterAll(async () => {
        await Promise.all([adminApp?.close(), doctorApp?.close()]);
        await testDb?.$disconnect();
    });
    beforeEach(async () => { await resetConsultData(); });
    afterEach(async () => { expect(await consistencyViolations()).toEqual([]); });

    async function visit(doctor: Awaited<ReturnType<typeof makeDoctor>>, user: { id: string }, patient: { id: string }, status: ConsultationStatus, minutesAhead: number, extra: Record<string, unknown> = {}) {
        const slot = await makeSlot(doctor.profile.id, minutesAhead, HOLDS_SLOT.includes(status) ? 'BOOKED' : 'AVAILABLE');
        const c = await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: doctor.profile.id, slotId: slot.id, startsAt: slot.startsAt, status });
        if (Object.keys(extra).length) await testDb.consultation.update({ where: { id: c.id }, data: extra });
        return c;
    }
    const auditRows = (patientId: string) => testDb.adminAuditLog.findMany({ where: { entity: 'Patient', targetId: patientId }, orderBy: { createdAt: 'asc' } });
    const fresh = (u: { id: string }) => testDb.user.findUniqueOrThrow({ where: { id: u.id } });

    describe('super admin: a person\'s health record', () => {
        async function fixture() {
            const superAdmin = await makeUser('SUPER_ADMIN');
            const user = await makeUser();
            const self = await makePatient(user.id);
            const mum = await testDb.patient.create({ data: { userId: user.id, name: 'Mum', relation: 'Mother', age: 60, gender: 'F', allergies: ['Sulfa'], allergiesConfirmedAt: new Date() } });
            const doctor = await makeDoctor();
            const done = await visit(doctor, user, mum, 'COMPLETED', -3 * 24 * 60, {
                note: { create: { complaints: 'Dizzy', diagnosis: 'Low BP' } },
                prescriptions: { create: { version: 1, medicines: [], recommendedTests: [], advice: 'Fluids', doctorSnapshot: {}, patientSnapshot: {} } },
                attachments: { create: { userId: user.id, storageKey: `att/${randomUUID()}.jpg`, name: 'ecg.jpg', mimeType: 'image/jpeg', sizeBytes: 9 } },
                payments: { create: { source: 'RAZORPAY', amountPaise: 50000, status: 'CAPTURED', razorpayOrderId: 'order_x', razorpayPaymentId: `pay_${randomUUID().slice(0, 12)}` } },
                recordSharedAt: new Date(),
            });
            await visit(doctor, user, self, 'COMPLETED', -2 * 24 * 60); // someone else on the same account
            const lab = await testDb.booking.create({ data: { userId: user.id, status: 'COMPLETED', slotDate: '2026-11-01', slotTime: '08:00', totalAmount: 500, items: { create: { patientId: mum.id, testCode: 'T1', testName: 'TSH', price: 500 } } } });
            const report = await testDb.report.create({ data: { bookingId: lab.id, vendorCustomerId: mum.id, sourceUrl: 'https://example.test/r.pdf', isFullReport: true } });
            const doc = await testDb.patientDocument.create({ data: { userId: user.id, patientId: mum.id, storageKey: `records/${randomUUID()}.pdf`, name: 'old-rx.pdf', mimeType: 'application/pdf', sizeBytes: 10 } });
            await testDb.recordShareConsent.create({ data: { consultationId: done.id, userId: user.id, granted: true, version: 'record-share-v1', channel: 'web' } });
            await testDb.healthRecordAccess.create({ data: { consultationId: done.id, doctorId: doctor.profile.id, patientId: mum.id, action: 'RECORD' } });
            return { superAdmin, user, self, mum, doctor, done, report, doc, attachmentId: (await testDb.consultationAttachment.findFirstOrThrow({ where: { consultationId: done.id } })).id };
        }

        it('shows everything about that one person and logs the view', async () => {
            const f = await fixture();
            const out = await admin.getPatientRecord(f.mum.id, { adminId: f.superAdmin.id, adminName: 'Asha', ipAddress: '10.1.1.1' });
            expect(out.person).toMatchObject({ name: 'Mum', allergies: ['Sulfa'] });
            expect(out.account).toMatchObject({ id: f.user.id, mobile: f.user.mobile });
            expect(out.consultations).toHaveLength(1);
            expect(out.consultations[0]).toMatchObject({
                id: f.done.id, status: 'COMPLETED', doctor: { displayName: 'Dr Test' }, note: { diagnosis: 'Low BP' },
                prescription: { advice: 'Fluids' }, attachments: [{ name: 'ecg.jpg' }], payments: [{ source: 'RAZORPAY', amountPaise: 50000 }],
            });
            expect(out.reports.map((r) => r.id)).toEqual([f.report.id]);
            expect(out.documents.map((d) => d.id)).toEqual([f.doc.id]);
            expect(out.consents).toEqual([expect.objectContaining({ granted: true, consultationId: f.done.id })]);
            expect(out.accessLog).toEqual([expect.objectContaining({ action: 'RECORD', doctorName: 'Dr Test' })]);
            expect(out.totals).toEqual({ consultations: 1, reports: 1, consents: 1, accessLog: 1 });
            expect(out.listLimit).toBe(100);
            expect(JSON.stringify(out)).not.toContain('storageKey');
            expect(await auditRows(f.mum.id)).toEqual([expect.objectContaining({ adminId: f.superAdmin.id, adminName: 'Asha', action: 'PATIENT_RECORD_VIEW', ipAddress: '10.1.1.1' })]);
        });

        it('opens files and reports of that person only, logging each open', async () => {
            const f = await fixture();
            const actor = { adminId: f.superAdmin.id, adminName: 'Asha' };
            const storage = fakeStorage();
            expect(await admin.openPatientFile(f.mum.id, 'document', f.doc.id, actor, { storage })).toMatchObject({ name: 'old-rx.pdf', url: expect.stringContaining('ttl=600') });
            expect(await admin.openPatientFile(f.mum.id, 'attachment', f.attachmentId, actor, { storage })).toMatchObject({ name: 'ecg.jpg' });
            expect(await admin.openPatientFile(f.mum.id, 'report', f.report.id, actor)).toMatchObject({ viewToken: expect.any(String) });
            // Ravi's (self) record id with Mum's files: not found.
            await expect(admin.openPatientFile(f.self.id, 'document', f.doc.id, actor, { storage })).rejects.toMatchObject({ status: 404 });
            await expect(admin.openPatientFile(f.self.id, 'report', f.report.id, actor)).rejects.toMatchObject({ status: 404 });
            const rows = await auditRows(f.mum.id);
            expect(rows.map((r) => [r.action, (r.newValue as { kind: string }).kind])).toEqual([['PATIENT_FILE_VIEW', 'document'], ['PATIENT_FILE_VIEW', 'attachment'], ['PATIENT_FILE_VIEW', 'report']]);
            expect(await auditRows(f.self.id)).toHaveLength(0);
        });

        it('only super admins get it through the routes; managers, doctors and patients get 403', async () => {
            const f = await fixture();
            const get = (path: string, user: { id: string; tokenVersion: number }) => fetch(`${adminApp.url}/admin/consult${path}`, { headers: { authorization: `Bearer ${tokenFor(user)}` } });
            const sa = await get(`/patients/${f.mum.id}/record`, await fresh(f.superAdmin));
            expect(sa.status).toBe(200);
            expect((await auditRows(f.mum.id))[0]).toMatchObject({ action: 'PATIENT_RECORD_VIEW', adminId: f.superAdmin.id });
            const manager = await testDb.user.create({ data: { mobile: `8${String(Date.now()).slice(-9)}`, role: 'MANAGER' } });
            for (const who of [manager, await fresh(f.doctor.user), await fresh(f.user)]) {
                expect((await get(`/patients/${f.mum.id}/record`, who)).status).toBe(403);
                expect((await get(`/users/${f.user.id}/people`, who)).status).toBe(403);
            }
            expect((await auditRows(f.mum.id))).toHaveLength(1);
            const people = await (await get(`/users/${f.user.id}/people`, await fresh(f.superAdmin))).json();
            expect(people.map((p: { name: string }) => p.name).sort()).toEqual(['Mum', 'Test Patient']);
            expect(people.find((p: { name: string }) => p.name === 'Mum')).toMatchObject({ consultations: 1, documents: 1 });
            expect((await get(`/patients/${randomUUID()}/record`, await fresh(f.superAdmin))).status).toBe(404);
            expect((await get(`/patients/${f.mum.id}/record/bogus/${f.doc.id}`, await fresh(f.superAdmin))).status).toBe(404);
            // Inherited object keys are not file kinds.
            expect((await get(`/patients/${f.mum.id}/record/constructor/${f.attachmentId}`, await fresh(f.superAdmin))).status).toBe(404);
            expect((await auditRows(f.mum.id)).filter((r) => r.action === 'PATIENT_FILE_VIEW')).toHaveLength(0);
        });

        it('hides the mobile of a deleted account', async () => {
            const f = await fixture();
            await testDb.user.update({ where: { id: f.user.id }, data: { deletedAt: new Date(), mobile: `deleted:${f.user.id}` } });
            const out = await admin.getPatientRecord(f.mum.id, { adminId: f.superAdmin.id, adminName: 'Asha' });
            expect(out.account).toMatchObject({ mobile: null, deleted: true });
        });
    });

    describe('doctor: Patients', () => {
        it('lists only people this doctor saw or is booked to see, newest visit first, with visit counts', async () => {
            const doctor = await makeDoctor();
            const other = await makeDoctor();
            const user = await makeUser();
            const asha = await testDb.patient.create({ data: { userId: user.id, name: 'Asha Rao', relation: 'Self', age: 30, gender: 'F' } });
            const bala = await testDb.patient.create({ data: { userId: user.id, name: 'Bala Rao', relation: 'Father', age: 64, gender: 'M' } });
            const chitra = await testDb.patient.create({ data: { userId: user.id, name: 'Chitra Rao', relation: 'Mother', age: 60, gender: 'F' } });
            const dev = await testDb.patient.create({ data: { userId: user.id, name: 'Dev Rao', relation: 'Son', age: 5, gender: 'M' } });
            await visit(doctor, user, asha, 'COMPLETED', -5 * 24 * 60);
            await visit(doctor, user, asha, 'COMPLETED', -1 * 24 * 60);
            await visit(doctor, user, bala, 'CONFIRMED', 2 * 24 * 60);
            await visit(doctor, user, chitra, 'CANCELLED', 3 * 24 * 60); // called off: not a patient
            await visit(doctor, user, chitra, 'PENDING_PAYMENT', 4 * 24 * 60); // unpaid: not a patient
            await visit(other, user, dev, 'COMPLETED', -2 * 24 * 60); // another doctor's patient

            const list = await patients.listDoctorPatients(doctor.profile.id, { page: 1 });
            expect(list.items.map((p) => [p.name, p.visits])).toEqual([['Bala Rao', 1], ['Asha Rao', 2]]);
            expect(list.nextPage).toBeNull();
            expect(Object.keys(list.items[0]).sort()).toEqual(['age', 'gender', 'id', 'lastVisitAt', 'name', 'visits']);
            expect((await patients.listDoctorPatients(doctor.profile.id, { page: 1, q: 'asha' })).items.map((p) => p.name)).toEqual(['Asha Rao']);
        });

        it('a patient shows only this doctor\'s own visits; one they never saw is 404 through the route', async () => {
            const doctor = await makeDoctor();
            const other = await makeDoctor();
            const user = await makeUser();
            const p = await makePatient(user.id);
            const mine = await visit(doctor, user, p, 'COMPLETED', -3 * 24 * 60, { note: { create: { complaints: 'Fever', diagnosis: 'Viral fever', followUpDays: 5 } } });
            await visit(other, user, p, 'COMPLETED', -2 * 24 * 60, { note: { create: { diagnosis: 'Secret other diagnosis' } } });
            const stranger = await makePatient((await makeUser()).id);

            const out = await patients.getDoctorPatient(doctor.profile.id, p.id);
            expect(out.visits.map((v) => v.id)).toEqual([mine.id]);
            expect(out.visits[0]).toMatchObject({ diagnosis: 'Viral fever', followUpDays: 5, prescription: null });
            expect(JSON.stringify(out)).not.toContain('Secret other diagnosis');
            expect(JSON.stringify(out)).not.toMatch(/mobile|phone/);

            const token = tokenFor(await fresh(doctor.user));
            const get = (path: string, t = token) => fetch(`${doctorApp.url}/doctor${path}`, { headers: { authorization: `Bearer ${t}` } });
            expect((await get(`/me/patients/${p.id}`)).status).toBe(200);
            expect((await get(`/me/patients/${stranger.id}`)).status).toBe(404);
            expect((await get(`/me/consultations/${mine.id}/record/constructor/${randomUUID()}`)).status).toBe(404);
            expect((await get('/me/patients')).status).toBe(200);
            expect((await get(`/me/patients?q=${'x'.repeat(81)}`)).status).toBe(400);
            expect((await get('/me/patients', tokenFor(await fresh(user)))).status).toBe(403);
        });

        it('pages 30 at a time', async () => {
            const doctor = await makeDoctor();
            const user = await makeUser();
            for (let i = 0; i < 31; i++) {
                const p = await testDb.patient.create({ data: { userId: user.id, name: `P${String(i).padStart(2, '0')}`, relation: 'Other', age: 20, gender: 'F' } });
                await visit(doctor, user, p, 'COMPLETED', -(i + 1) * 60);
            }
            const first = await patients.listDoctorPatients(doctor.profile.id, { page: 1 });
            expect(first.items).toHaveLength(30);
            expect(first.items[0].name).toBe('P00');
            expect(first.nextPage).toBe(2);
            const second = await patients.listDoctorPatients(doctor.profile.id, { page: 2 });
            expect(second.items.map((p) => p.name)).toEqual(['P30']);
            expect(second.nextPage).toBeNull();
        });
    });
});
