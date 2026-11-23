import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { describeDb, makeDoctor, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

// Plain functions, not vi.fn: the suite's clearMocks/restoreMocks would wipe a factory mock.
const s3 = vi.hoisted(() => ({ uploaded: [] as { key: string; mimeType: string; bytes: number }[], deleted: [] as string[] }));
vi.mock('../../services/imageUpload', () => ({
    uploadImage: async (buffer: Buffer, filename: string, mimeType: string) => {
        const key = `doctor-photos/${s3.uploaded.length}-${filename}`;
        s3.uploaded.push({ key, mimeType, bytes: buffer.length });
        return { url: `https://s3.test/${key}`, key };
    },
    refreshPresignedUrl: async (key: string) => `https://s3.test/${key}?X-Amz-Signature=fresh`,
    deleteImage: async (key: string) => { s3.deleted.push(key); },
}));

const jpegBytes = (size = 64) => {
    const b = new Uint8Array(size);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    return b;
};
const pngBytes = (size = 64) => {
    const b = new Uint8Array(size);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return b;
};

describeDb('doctor photos (real Postgres)', () => {
    let MAX_PHOTO_BYTES: number;
    let doctorApp: { url: string; close: () => Promise<void> };
    let publicApp: { url: string; close: () => Promise<void> };
    let adminApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        MAX_PHOTO_BYTES = (await import('./doctors.photo')).MAX_PHOTO_BYTES;
        const routes = await import('./doctors.routes');
        doctorApp = await serve('/doctor', routes.doctorRoutes);
        publicApp = await serve('/consult', routes.consultPublicRoutes);
        adminApp = await serve('/admin', routes.consultAdminRoutes);
    });
    afterAll(async () => {
        await Promise.all([doctorApp?.close(), publicApp?.close(), adminApp?.close()]);
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        s3.uploaded.length = 0;
        s3.deleted.length = 0;
    });

    function upload(token: string, bytes: Uint8Array, filename = 'photo.jpg', type = 'image/jpeg') {
        const form = new FormData();
        form.append('photo', new Blob([bytes], { type }), filename);
        return fetch(`${doctorApp.url}/doctor/me/photo`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    }
    function adminUpload(token: string, doctorId: string, bytes: Uint8Array) {
        const form = new FormData();
        form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg');
        return fetch(`${adminApp.url}/admin/doctors/${doctorId}/photo`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    }
    const photoOf = (id: string) => testDb.doctorProfile.findUniqueOrThrow({ where: { id }, select: { photoKey: true, photoUrl: true } });

    describe('upload route', () => {
        it('accepts a real JPEG and stores the key plus a stable DocNow link', async () => {
            const d = await makeDoctor({ status: 'PENDING' });
            const res = await upload(tokenFor(d.user), jpegBytes());
            expect(res.status).toBe(200);
            const row = await photoOf(d.profile.id);
            expect(row.photoKey).toBe(s3.uploaded[0].key);
            expect(s3.uploaded[0].mimeType).toBe('image/jpeg');
            expect((await res.json()).photoUrl).toBe(row.photoUrl);
            expect(row.photoUrl).toContain(`/api/consult/doctors/${d.profile.id}/photo`);
        });

        it('accepts a PNG whose name and content-type claim JPEG, saving it as .png', async () => {
            const d = await makeDoctor({ status: 'PENDING' });
            expect((await upload(tokenFor(d.user), pngBytes(), 'photo.jpg', 'image/jpeg')).status).toBe(200);
            expect(s3.uploaded[0]).toMatchObject({ mimeType: 'image/png' });
            expect(s3.uploaded[0].key.endsWith('.png')).toBe(true);
        });

        it('refuses bytes that are not an image even when the name and type say JPEG', async () => {
            const d = await makeDoctor({ status: 'PENDING' });
            const res = await upload(tokenFor(d.user), new TextEncoder().encode('%PDF-1.7 not an image'), 'photo.jpg', 'image/jpeg');
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe('Upload a JPG, PNG or WebP photo');
            expect(s3.uploaded).toEqual([]);
            expect(await photoOf(d.profile.id)).toMatchObject({ photoKey: null, photoUrl: null });
        });

        it('refuses a request with no file and one with no token', async () => {
            const d = await makeDoctor({ status: 'PENDING' });
            const empty = await fetch(`${doctorApp.url}/doctor/me/photo`, { method: 'POST', headers: { authorization: `Bearer ${tokenFor(d.user)}` }, body: new FormData() });
            expect(empty.status).toBe(400);
            expect((await empty.json()).error).toBe('Choose a photo to upload');
            expect((await fetch(`${doctorApp.url}/doctor/me/photo`, { method: 'POST', body: new FormData() })).status).toBe(401);
        });

        it('refuses a signed-in user with no doctor profile', async () => {
            const user = await makeUser();
            const res = await upload(tokenFor(user), jpegBytes());
            expect(res.status).toBe(404);
            expect((await res.json()).error).toBe('No doctor profile');
        });

        it('takes a photo just under 3 MB and refuses one just over', async () => {
            const d = await makeDoctor({ status: 'PENDING' });
            const ok = await upload(tokenFor(d.user), jpegBytes(MAX_PHOTO_BYTES - 1));
            expect(ok.status).toBe(200);
            expect(s3.uploaded[0].bytes).toBe(MAX_PHOTO_BYTES - 1);
            const tooBig = await upload(tokenFor(d.user), jpegBytes(MAX_PHOTO_BYTES + 1));
            expect(tooBig.status).toBe(413);
            expect((await tooBig.json()).error).toBe('Photos can be up to 3 MB');
            expect(s3.uploaded).toHaveLength(1);
        });

        it('replaces the stored key on a second upload and drops the old file', async () => {
            const d = await makeDoctor({ status: 'PENDING' });
            await upload(tokenFor(d.user), jpegBytes());
            const first = (await photoOf(d.profile.id)).photoKey!;
            await upload(tokenFor(d.user), pngBytes());
            const second = (await photoOf(d.profile.id)).photoKey!;
            expect(second).not.toBe(first);
            expect(s3.deleted).toEqual([first]);
        });
    });

    describe('stable photo link', () => {
        it('redirects to a fresh signed link and lets browsers cache the redirect', async () => {
            const d = await makeDoctor({ status: 'PENDING' });
            await upload(tokenFor(d.user), jpegBytes());
            const key = (await photoOf(d.profile.id)).photoKey!;
            const res = await fetch(`${publicApp.url}/consult/doctors/${d.profile.id}/photo`, { redirect: 'manual' });
            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe(`https://s3.test/${key}?X-Amz-Signature=fresh`);
            expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
        });

        it('serves a pending doctor\'s photo too, because approval needs one first', async () => {
            const d = await makeDoctor({ status: 'PENDING' });
            await upload(tokenFor(d.user), jpegBytes());
            expect((await fetch(`${publicApp.url}/consult/doctors/${d.profile.id}/photo`, { redirect: 'manual' })).status).toBe(302);
        });

        it('answers 404 for a doctor with no photo, an unknown id and a malformed id', async () => {
            const d = await makeDoctor();
            for (const id of [d.profile.id, randomUUID(), 'not-a-uuid']) {
                const res = await fetch(`${publicApp.url}/consult/doctors/${id}/photo`, { redirect: 'manual' });
                expect(res.status).toBe(404);
                expect((await res.json()).error).toBe('No photo');
            }
        });
    });

    describe('approval needs a photo', () => {
        async function admin() {
            const user = await makeUser('SUPER_ADMIN');
            return { user, token: tokenFor(user) };
        }
        const approve = (token: string, id: string) =>
            fetch(`${adminApp.url}/admin/doctors/${id}/approve`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
        const post = (token: string, path: string, body: unknown) =>
            fetch(`${adminApp.url}/admin${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

        it('refuses a self-registered applicant with no photo and leaves the row pending', async () => {
            const a = await admin();
            const d = await makeDoctor({ status: 'PENDING' });
            const res = await approve(a.token, d.profile.id);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe("Add the doctor's photo before approving");
            expect((await testDb.doctorProfile.findUniqueOrThrow({ where: { id: d.profile.id } })).status).toBe('PENDING');
        });

        it('approves the same applicant once a photo is uploaded', async () => {
            const a = await admin();
            const d = await makeDoctor({ status: 'PENDING' });
            expect((await upload(tokenFor(d.user), jpegBytes())).status).toBe(200);
            expect((await approve(a.token, d.profile.id)).status).toBe(200);
            const row = await testDb.doctorProfile.findUniqueOrThrow({ where: { id: d.profile.id } });
            expect(row).toMatchObject({ status: 'APPROVED', reviewedById: a.user.id });
            expect(row.photoUrl).not.toBeNull();
        });

        it('refuses to bring back an admin-created doctor who went live without a photo, until one is added', async () => {
            const a = await admin();
            // Made before photos were required for admin-created doctors.
            const d = await makeDoctor({ status: 'SUSPENDED' });
            await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { createdByAdminId: a.user.id } });

            const refused = await approve(a.token, d.profile.id);
            expect(refused.status).toBe(400);
            expect((await refused.json()).error).toBe("Add the doctor's photo before approving");
            expect((await adminUpload(a.token, d.profile.id, jpegBytes())).status).toBe(200);
            expect((await approve(a.token, d.profile.id)).status).toBe(200);
        });

        it('still refuses approval without a fee, before the photo rule is reached', async () => {
            const a = await admin();
            const d = await makeDoctor({ status: 'PENDING' });
            await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { consultationFee: 0 } });
            const res = await approve(a.token, d.profile.id);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe('Set a consultation fee before approving');
        });
    });

    describe('admin create needs a photo', () => {
        async function admin() {
            const user = await makeUser('SUPER_ADMIN');
            return { user, token: tokenFor(user) };
        }
        async function fields(overrides: Record<string, unknown> = {}) {
            const specialty = await testDb.specialty.upsert({ where: { name: 'Test Specialty' }, update: {}, create: { name: 'Test Specialty', slug: 'test-specialty' } });
            return {
                mobile: `9${String(Date.now()).slice(-9)}`, displayName: 'Dr Admin Made', specialtyId: specialty.id,
                qualification: 'MBBS', registrationNumber: `A-${randomUUID().slice(0, 8)}`, registrationCouncil: 'Test Council',
                experienceYears: 4, languages: ['English'], consultationFee: 400, slotMinutes: 15, ...overrides,
            };
        }
        function create(token: string, body: unknown, photo?: Uint8Array) {
            const form = new FormData();
            form.append('data', JSON.stringify(body));
            if (photo) form.append('photo', new Blob([photo], { type: 'image/jpeg' }), 'photo.jpg');
            return fetch(`${adminApp.url}/admin/doctors`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
        }

        it('creates a live doctor with the photo stored and its stable link saved', async () => {
            const a = await admin();
            const res = await create(a.token, await fields(), jpegBytes());
            expect(res.status).toBe(201);
            const body = await res.json();
            const row = await testDb.doctorProfile.findUniqueOrThrow({ where: { id: body.id } });
            expect(row).toMatchObject({ status: 'APPROVED', createdByAdminId: a.user.id, photoKey: s3.uploaded[0].key });
            expect(row.photoUrl).toContain(`/api/consult/doctors/${row.id}/photo?v=`);
            expect(body.photoUrl).toBe(row.photoUrl);
            expect((await fetch(`${publicApp.url}/consult/doctors/${row.id}/photo`, { redirect: 'manual' })).status).toBe(302);
        });

        it('refuses a request without a photo, or with a file that is not a photo, and creates nothing', async () => {
            const a = await admin();
            const body = await fields();
            for (const [photo, error] of [[undefined, "Add the doctor's photo"], [new TextEncoder().encode('%PDF-1.7'), 'Upload a JPG, PNG or WebP photo']] as const) {
                const res = await create(a.token, body, photo);
                expect(res.status).toBe(400);
                expect((await res.json()).error).toBe(error);
            }
            // A JSON body (the old form) has no photo either.
            const json = await fetch(`${adminApp.url}/admin/doctors`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` }, body: JSON.stringify(body) });
            expect(json.status).toBe(400);
            expect(s3.uploaded).toEqual([]);
            expect(await testDb.user.findUnique({ where: { mobile: body.mobile } })).toBeNull();
        });

        it('checks the details before the photo, and ignores a photo link sent in the details', async () => {
            const a = await admin();
            const bad = await create(a.token, await fields({ mobile: '123' }), jpegBytes());
            expect(bad.status).toBe(400);
            expect((await bad.json()).error).toBe('Valid 10-digit mobile number required');
            expect(s3.uploaded).toEqual([]);

            const res = await create(a.token, await fields({ photoUrl: 'https://example.com/someone-else.jpg' }), jpegBytes());
            expect(res.status).toBe(201);
            expect((await res.json()).photoUrl).not.toContain('example.com');
        });

        it('removes the stored photo when the doctor cannot be created', async () => {
            const a = await admin();
            const existing = await makeDoctor();
            const res = await create(a.token, await fields({ mobile: existing.user.mobile }), jpegBytes());
            expect(res.status).toBe(409);
            expect(s3.uploaded).toHaveLength(1);
            await vi.waitFor(() => expect(s3.deleted).toEqual([s3.uploaded[0].key]));
        });
    });

    describe('admin photo upload', () => {
        it('adds a photo to a live doctor, drops the old file on replace, and is audit-logged', async () => {
            const user = await makeUser('SUPER_ADMIN');
            const d = await makeDoctor();
            expect((await adminUpload(tokenFor(user), d.profile.id, jpegBytes())).status).toBe(200);
            const first = (await photoOf(d.profile.id)).photoKey!;
            expect(first).toBe(s3.uploaded[0].key);
            const res = await adminUpload(tokenFor(user), d.profile.id, pngBytes());
            expect(res.status).toBe(200);
            const row = await photoOf(d.profile.id);
            expect(row.photoKey).toBe(s3.uploaded[1].key);
            expect((await res.json()).photoUrl).toBe(row.photoUrl);
            expect(s3.deleted).toEqual([first]);
            expect(await testDb.adminAuditLog.count({ where: { action: 'DOCTOR_PHOTO_UPDATE', targetId: d.profile.id, adminId: user.id } })).toBe(2);
        });

        it('is for super admins only, and answers 404 for an unknown doctor', async () => {
            const d = await makeDoctor();
            expect((await adminUpload(tokenFor(d.user), d.profile.id, jpegBytes())).status).toBe(403);
            expect((await adminUpload(tokenFor(await makeUser()), d.profile.id, jpegBytes())).status).toBe(403);
            const admin = await makeUser('SUPER_ADMIN');
            for (const id of [randomUUID(), 'not-a-uuid']) {
                const res = await adminUpload(tokenFor(admin), id, jpegBytes());
                expect(res.status).toBe(404);
                expect((await res.json()).error).toBe('Doctor not found');
            }
            expect(s3.uploaded).toEqual([]);
            expect(await photoOf(d.profile.id)).toMatchObject({ photoKey: null, photoUrl: null });
        });
    });
});
