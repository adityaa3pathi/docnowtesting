/**
 * P11: reviews (real Postgres). Rules (Aditya, 2026-11-24): one doctor review per completed
 * consultation, by the booker or an accepted family member, within 48 h of the end; the doctor only
 * reads; hidden and deleted reviews are left out of averages; the average shows from 3 visible
 * reviews; admins moderate (hide, unhide, soft delete, redact, reply), never write; every step audited.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

const HOUR = 3_600_000;

describeDb('reviews (real Postgres)', () => {
    let reviews: typeof import('./consultations.reviews');
    let patientApp: { url: string; close: () => Promise<void> };
    let publicApp: { url: string; close: () => Promise<void> };
    let doctorApp: { url: string; close: () => Promise<void> };
    let adminApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        reviews = await import('./consultations.reviews');
        const routes = await import('./consultations.routes');
        const doctors = await import('./doctors.routes');
        patientApp = await serve('/consult', routes.consultPatientRoutes);
        publicApp = await serve('/consult', doctors.consultPublicRoutes);
        doctorApp = await serve('/doctor', doctors.doctorRoutes);
        adminApp = await serve('/admin/consult', doctors.consultAdminRoutes);
    });
    afterAll(async () => {
        await Promise.all([patientApp, publicApp, doctorApp, adminApp].map((a) => a?.close()));
        await testDb?.$disconnect();
    });
    beforeEach(async () => {
        await resetConsultData();
        await testDb.$executeRawUnsafe('TRUNCATE "AppReview"');
    });

    async function call(app: { url: string }, method: string, path: string, user?: { id: string }, body?: unknown) {
        const headers: Record<string, string> = body !== undefined ? { 'content-type': 'application/json' } : {};
        if (user) headers.authorization = `Bearer ${tokenFor(await testDb.user.findUniqueOrThrow({ where: { id: user.id } }))}`;
        const res = await fetch(`${app.url}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json().catch(() => null) };
    }

    /** A consultation the doctor ended `endedHoursAgo` hours ago (or one still in another state). */
    async function visit(opts: { doctorId?: string; endedHoursAgo?: number; status?: 'COMPLETED' | 'CONFIRMED' | 'IN_PROGRESS'; user?: { id: string }; patientId?: string } = {}) {
        const doctor = opts.doctorId ? null : await makeDoctor();
        const doctorId = opts.doctorId ?? doctor!.profile.id;
        const user = opts.user ?? (await makeUser());
        const patientId = opts.patientId ?? (await makePatient(user.id)).id;
        const slot = await makeSlot(doctorId, -2 * 60, 'BOOKED');
        const status = opts.status ?? 'COMPLETED';
        const c = await makeConsultation({ userId: user.id, patientId, doctorId, slotId: slot.id, startsAt: slot.startsAt, status });
        if (status === 'COMPLETED') {
            await testDb.consultation.update({ where: { id: c.id }, data: { endedAt: new Date(Date.now() - (opts.endedHoursAgo ?? 1) * HOUR) } });
        }
        return { id: c.id, user, doctorId, doctorUser: doctor?.user, patientId };
    }

    const review = (app: { url: string }, id: string, user: { id: string }, body: unknown) => call(app, 'POST', `/consult/bookings/${id}/review`, user, body);

    describe('doctor reviews: who and when', () => {
        it('the booker reviews a completed consultation once; a second review is refused', async () => {
            const v = await visit();
            const first = await review(patientApp, v.id, v.user, { rating: 5, text: '  Listened carefully.  ' });
            expect(first.status).toBe(201);
            expect(first.body).toMatchObject({ rating: 5, text: 'Listened carefully.', status: 'VISIBLE', editedByDocNow: false });

            const again = await review(patientApp, v.id, v.user, { rating: 1 });
            expect(again.status).toBe(409);
            expect(await testDb.doctorReview.count({ where: { consultationId: v.id } })).toBe(1);
            // Two at once: the unique index keeps one.
            const v2 = await visit();
            const both = await Promise.all([review(patientApp, v2.id, v2.user, { rating: 4 }), review(patientApp, v2.id, v2.user, { rating: 2 })]);
            expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
            expect(await testDb.doctorReview.count({ where: { consultationId: v2.id } })).toBe(1);
        });

        it('the 48 h window: closed before the end and from 48 h after it', async () => {
            const live = await visit({ status: 'IN_PROGRESS' });
            expect((await review(patientApp, live.id, live.user, { rating: 5 })).status).toBe(409);

            const late = await visit({ endedHoursAgo: 48.01 });
            const closed = await review(patientApp, late.id, late.user, { rating: 5 });
            expect(closed).toMatchObject({ status: 409, body: { error: 'Reviews close 48 hours after the consultation' } });

            const justIn = await visit({ endedHoursAgo: 47.9 });
            expect((await review(patientApp, justIn.id, justIn.user, { rating: 3 })).status).toBe(201);

            // The service's own clock, exactly at the boundary.
            const edge = await visit({ endedHoursAgo: 0 });
            const ended = (await testDb.consultation.findUniqueOrThrow({ where: { id: edge.id } })).endedAt!;
            await expect(reviews.submitDoctorReview(edge.user.id, edge.id, { rating: 4, text: null }, { now: new Date(ended.getTime() + reviews.REVIEW_WINDOW_MS) }))
                .rejects.toMatchObject({ status: 409 });
            await expect(reviews.submitDoctorReview(edge.user.id, edge.id, { rating: 4, text: null }, { now: new Date(ended.getTime() + reviews.REVIEW_WINDOW_MS - 1) }))
                .resolves.toMatchObject({ rating: 4 });
        });

        it('an accepted family member may review; a pending link, a stranger and the doctor get 404', async () => {
            const booker = await makeUser();
            const mother = await makeUser();
            const pending = await makeUser();
            const linked = await testDb.patient.create({
                data: { userId: booker.id, name: 'Kamla', relation: 'Mother', age: 62, gender: 'F', phone: mother.mobile, linkedUserId: mother.id, linkedAt: new Date() },
            });
            const unlinked = await testDb.patient.create({ data: { userId: booker.id, name: 'Ravi', relation: 'Brother', age: 30, gender: 'M', phone: pending.mobile } });

            const forMother = await visit({ user: booker, patientId: linked.id });
            expect((await review(patientApp, forMother.id, mother, { rating: 4 })).status).toBe(201);
            const row = await testDb.doctorReview.findUniqueOrThrow({ where: { consultationId: forMother.id } });
            expect(row.authorUserId).toBe(mother.id);

            const forBrother = await visit({ user: booker, patientId: unlinked.id });
            expect((await review(patientApp, forBrother.id, pending, { rating: 1 })).status).toBe(404);
            expect((await review(patientApp, forBrother.id, await makeUser(), { rating: 1 })).status).toBe(404);
            expect((await review(patientApp, forBrother.id, forBrother.doctorUser!, { rating: 5 })).status).toBe(404);
            expect(await testDb.doctorReview.count({ where: { consultationId: forBrother.id } })).toBe(0);
        });

        it('refuses ratings outside 1 to 5 and over-long text (and the database refuses them too)', async () => {
            const v = await visit();
            for (const rating of [0, 6, 4.5, '5', null]) {
                expect((await review(patientApp, v.id, v.user, { rating })).status).toBe(400);
            }
            expect((await review(patientApp, v.id, v.user, { rating: 4, text: 'x'.repeat(1001) })).status).toBe(400);
            await expect(testDb.doctorReview.create({ data: { consultationId: v.id, doctorId: v.doctorId, authorUserId: v.user.id, rating: 6 } }))
                .rejects.toThrow();
        });

        it('the booking page shows the review state to the booker and not to a stranger', async () => {
            const v = await visit();
            const before = await call(patientApp, 'GET', `/consult/bookings/${v.id}`, v.user);
            expect(before.body.review).toMatchObject({ review: null, canReview: true });
            expect(Date.parse(before.body.review.closesAt)).toBeGreaterThan(Date.now() + 46 * HOUR);

            await review(patientApp, v.id, v.user, { rating: 2, text: 'Rushed.' });
            const after = await call(patientApp, 'GET', `/consult/bookings/${v.id}`, v.user);
            expect(after.body.review).toMatchObject({ canReview: false, review: { rating: 2, text: 'Rushed.' } });
            expect((await call(patientApp, 'GET', `/consult/bookings/${v.id}`, await makeUser())).status).toBe(404);
        });
    });

    describe('averages and what each side sees', () => {
        async function threeReviews() {
            const doctor = await makeDoctor();
            const ids: string[] = [];
            for (const rating of [5, 4, 4]) {
                const v = await visit({ doctorId: doctor.profile.id });
                const res = await review(patientApp, v.id, v.user, { rating, text: `Rated ${rating}` });
                ids.push(res.body.id);
            }
            return { doctor, ids };
        }

        it('the average shows from 3 visible reviews; hidden and deleted ones are left out', async () => {
            const { doctor, ids } = await threeReviews();
            const profile = await call(publicApp, 'GET', `/consult/doctors/${doctor.profile.id}`);
            expect(profile.body.rating).toEqual({ average: 4.3, count: 3 });
            const list = await call(publicApp, 'GET', '/consult/doctors');
            expect(list.body.find((d: { id: string }) => d.id === doctor.profile.id).rating).toEqual({ average: 4.3, count: 3 });

            const admin = await makeUser('SUPER_ADMIN');
            expect((await call(adminApp, 'POST', `/admin/consult/reviews/doctor/${ids[0]}/hide`, admin, { reason: 'Under check' })).status).toBe(200);
            const hidden = await call(publicApp, 'GET', `/consult/doctors/${doctor.profile.id}/reviews`);
            expect(hidden.body).toMatchObject({ total: 2, rating: null });
            expect(hidden.body.items.map((r: { id: string }) => r.id)).not.toContain(ids[0]);
            expect((await call(publicApp, 'GET', `/consult/doctors/${doctor.profile.id}`)).body.rating).toBeNull();

            // Another visible one brings it back over the line, still without the hidden 5.
            const v = await visit({ doctorId: doctor.profile.id });
            await review(patientApp, v.id, v.user, { rating: 1 });
            expect((await call(publicApp, 'GET', `/consult/doctors/${doctor.profile.id}`)).body.rating).toEqual({ average: 3, count: 3 });
            await call(adminApp, 'POST', `/admin/consult/reviews/doctor/${ids[1]}/delete`, admin, { reason: 'Spam' });
            expect((await call(publicApp, 'GET', `/consult/doctors/${doctor.profile.id}`)).body.rating).toBeNull();
        });

        it('public reviews never carry the author, the patient or the consultation', async () => {
            const { doctor } = await threeReviews();
            const res = await call(publicApp, 'GET', `/consult/doctors/${doctor.profile.id}/reviews`);
            expect(res.status).toBe(200);
            for (const item of res.body.items) expect(Object.keys(item).sort()).toEqual(['createdAt', 'editedByDocNow', 'id', 'rating', 'reply', 'text']);
            expect(JSON.stringify(res.body)).not.toMatch(/Test Patient|authorUserId|consultationId/);
            // A doctor who is not approved has no public reviews page.
            await testDb.doctorProfile.update({ where: { id: doctor.profile.id }, data: { status: 'SUSPENDED' } });
            expect((await call(publicApp, 'GET', `/consult/doctors/${doctor.profile.id}/reviews`)).status).toBe(404);
        });

        it('the doctor reads their own visible reviews and cannot change them', async () => {
            const { doctor, ids } = await threeReviews();
            const admin = await makeUser('SUPER_ADMIN');
            await call(adminApp, 'POST', `/admin/consult/reviews/doctor/${ids[2]}/hide`, admin, { reason: 'Abusive' });

            const mine = await call(doctorApp, 'GET', '/doctor/me/reviews', doctor.user);
            expect(mine.status).toBe(200);
            expect(mine.body).toMatchObject({ total: 2, average: 4.5, shownPublicly: false, minCountToShow: 3 });
            expect(JSON.stringify(mine.body)).not.toMatch(/authorUserId|consultationId|Test Patient/);

            // No write route exists for doctors; the admin routes refuse them.
            for (const [method, path] of [['PATCH', `/doctor/me/reviews/${ids[0]}`], ['PUT', `/doctor/me/reviews/${ids[0]}`], ['DELETE', `/doctor/me/reviews/${ids[0]}`]]) {
                expect((await call(doctorApp, method, path, doctor.user, { rating: 5 })).status).toBe(404);
            }
            expect((await call(adminApp, 'POST', `/admin/consult/reviews/doctor/${ids[0]}/redact`, doctor.user, { text: 'Great', reason: 'mine' })).status).toBe(403);
            expect((await testDb.doctorReview.findUniqueOrThrow({ where: { id: ids[0] } })).text).toBe('Rated 5');
            // Another doctor sees none of them.
            const other = await makeDoctor();
            expect((await call(doctorApp, 'GET', '/doctor/me/reviews', other.user)).body).toMatchObject({ total: 0, items: [] });
        });
    });

    describe('moderation', () => {
        async function oneReview() {
            const v = await visit();
            const res = await review(patientApp, v.id, v.user, { rating: 1, text: 'Call me on 9876543210, Dr was late' });
            return { ...v, reviewId: res.body.id as string, admin: await makeUser('SUPER_ADMIN') };
        }
        const moderate = (r: { admin: { id: string } }, kind: string, id: string, action: string, body: unknown) =>
            call(adminApp, 'POST', `/admin/consult/reviews/${kind}/${id}/${action}`, r.admin, body);

        it('hide and unhide need a reason, follow the current state and are audited', async () => {
            const r = await oneReview();
            expect((await moderate(r, 'doctor', r.reviewId, 'hide', {})).status).toBe(400);
            expect((await moderate(r, 'doctor', r.reviewId, 'hide', { reason: 'Checking' })).body.status).toBe('HIDDEN');
            expect((await moderate(r, 'doctor', r.reviewId, 'hide', { reason: 'Again' })).status).toBe(409);
            expect((await moderate(r, 'doctor', r.reviewId, 'unhide', { reason: 'Fine after all' })).body.status).toBe('VISIBLE');

            const audit = await testDb.adminAuditLog.findMany({ where: { targetId: r.reviewId }, orderBy: { createdAt: 'asc' } });
            expect(audit.map((a) => [a.action, a.entity, a.adminId])).toEqual([
                ['REVIEW_HIDE', 'DoctorReview', r.admin.id],
                ['REVIEW_UNHIDE', 'DoctorReview', r.admin.id],
            ]);
            expect(audit[0].newValue).toMatchObject({ reason: 'Checking', status: 'HIDDEN' });
        });

        it('delete is soft and final: the row stays, nothing brings it back', async () => {
            const r = await oneReview();
            expect((await moderate(r, 'doctor', r.reviewId, 'delete', { reason: 'Spam' })).body.status).toBe('DELETED');
            expect(await testDb.doctorReview.findUnique({ where: { id: r.reviewId } })).not.toBeNull();
            for (const [action, body] of [['unhide', { reason: 'undo' }], ['hide', { reason: 'x y z' }], ['reply', { text: 'Hi' }], ['redact', { text: 'x', reason: 'pii' }]] as const) {
                expect((await moderate(r, 'doctor', r.reviewId, action, body)).status).toBe(409);
            }
            const audit = await testDb.adminAuditLog.findFirstOrThrow({ where: { targetId: r.reviewId, action: 'REVIEW_DELETE' } });
            expect(audit.isDestructive).toBe(true);
        });

        it('redact replaces the text, marks it "edited by DocNow" and keeps the old words nowhere', async () => {
            const r = await oneReview();
            const res = await moderate(r, 'doctor', r.reviewId, 'redact', { text: 'Dr was late', reason: 'Phone number' });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ text: 'Dr was late', rating: 1 });
            const pub = await call(publicApp, 'GET', `/consult/doctors/${r.doctorId}/reviews`);
            expect(pub.body.items[0]).toMatchObject({ text: 'Dr was late', editedByDocNow: true });

            const audit = await testDb.adminAuditLog.findMany({ where: { targetId: r.reviewId } });
            expect(JSON.stringify(audit)).not.toContain('9876543210');
            expect(audit[0]).toMatchObject({ action: 'REVIEW_REDACT', isDestructive: true });
            // The rating is never the admin's to change.
            await moderate(r, 'doctor', r.reviewId, 'redact', { text: null, reason: 'All personal', rating: 5 });
            expect(await testDb.doctorReview.findUniqueOrThrow({ where: { id: r.reviewId } })).toMatchObject({ text: null, rating: 1 });
        });

        it('a reply shows as DocNow\'s under the review and can be taken down', async () => {
            const r = await oneReview();
            await moderate(r, 'doctor', r.reviewId, 'reply', { text: 'Sorry about the wait, we have spoken to the doctor.' });
            let pub = await call(publicApp, 'GET', `/consult/doctors/${r.doctorId}/reviews`);
            expect(pub.body.items[0].reply).toMatchObject({ text: 'Sorry about the wait, we have spoken to the doctor.' });
            await moderate(r, 'doctor', r.reviewId, 'reply', { text: '' });
            pub = await call(publicApp, 'GET', `/consult/doctors/${r.doctorId}/reviews`);
            expect(pub.body.items[0].reply).toBeNull();
        });

        it('only super admins list and moderate; the list carries who wrote what for them', async () => {
            const r = await oneReview();
            expect((await call(adminApp, 'GET', '/admin/consult/reviews', r.user)).status).toBe(403);
            expect((await call(adminApp, 'GET', '/admin/consult/reviews')).status).toBe(401);
            expect((await call(adminApp, 'POST', `/admin/consult/reviews/doctor/${r.reviewId}/hide`, r.user, { reason: 'mine now' })).status).toBe(403);

            const list = await call(adminApp, 'GET', '/admin/consult/reviews?kind=doctor', r.admin);
            expect(list.body.items[0]).toMatchObject({ id: r.reviewId, consultationId: r.id, author: { id: r.user.id }, patientName: 'Test Patient' });
            expect((await call(adminApp, 'GET', '/admin/consult/reviews?kind=doctor&status=HIDDEN', r.admin)).body.total).toBe(0);
            expect((await call(adminApp, 'POST', `/admin/consult/reviews/doctor/${r.reviewId}/approve`, r.admin, {})).status).toBe(404);
            expect((await call(adminApp, 'POST', `/admin/consult/reviews/doctor/00000000-0000-4000-8000-000000000000/hide`, r.admin, { reason: 'none' })).status).toBe(404);
        });
    });

    describe('app reviews', () => {
        it('one per account, editable by its author; others cannot read or change it', async () => {
            const user = await makeUser();
            expect((await call(patientApp, 'GET', '/consult/app-review', user)).body).toEqual({ review: null });
            const first = await call(patientApp, 'PUT', '/consult/app-review', user, { rating: 3, text: 'Okay' });
            expect(first.body.review).toMatchObject({ rating: 3, text: 'Okay', status: 'VISIBLE' });
            const edit = await call(patientApp, 'PUT', '/consult/app-review', user, { rating: 5, text: 'Better now' });
            expect(edit.body.review).toMatchObject({ id: first.body.review.id, rating: 5, text: 'Better now' });
            expect(await testDb.appReview.count({ where: { userId: user.id } })).toBe(1);

            const other = await makeUser();
            expect((await call(patientApp, 'GET', '/consult/app-review', other)).body).toEqual({ review: null });
            expect((await call(patientApp, 'PUT', '/consult/app-review')).status).toBe(401);
        });

        it('hidden stays hidden when edited; deleted is closed; new words clear a redaction', async () => {
            const user = await makeUser();
            const admin = await makeUser('SUPER_ADMIN');
            const { body } = await call(patientApp, 'PUT', '/consult/app-review', user, { rating: 2, text: 'Mail me at a@b.in' });
            const id = body.review.id;

            await call(adminApp, 'POST', `/admin/consult/reviews/app/${id}/redact`, admin, { text: 'Mail me', reason: 'Email' });
            expect((await call(patientApp, 'PUT', '/consult/app-review', user, { rating: 3, text: 'Mail me' })).body.review.editedByDocNow).toBe(true);
            expect((await call(patientApp, 'PUT', '/consult/app-review', user, { rating: 3, text: 'Slow support' })).body.review.editedByDocNow).toBe(false);

            await call(adminApp, 'POST', `/admin/consult/reviews/app/${id}/hide`, admin, { reason: 'Checking' });
            expect((await call(patientApp, 'PUT', '/consult/app-review', user, { rating: 4 })).body.review.status).toBe('HIDDEN');
            expect((await call(publicApp, 'GET', '/consult/app-reviews')).body).toMatchObject({ total: 0, rating: null });

            await call(adminApp, 'POST', `/admin/consult/reviews/app/${id}/delete`, admin, { reason: 'Spam' });
            const closed = await call(patientApp, 'PUT', '/consult/app-review', user, { rating: 5 });
            expect(closed.status).toBe(409);
            expect(await testDb.appReview.findUniqueOrThrow({ where: { id } })).toMatchObject({ rating: 4, status: 'DELETED' });
        });

        it('the public list is anonymous and averages visible reviews from 3', async () => {
            for (const rating of [5, 4]) await call(patientApp, 'PUT', '/consult/app-review', await makeUser(), { rating, text: `App ${rating}` });
            expect((await call(publicApp, 'GET', '/consult/app-reviews')).body).toMatchObject({ total: 2, rating: null });
            await call(patientApp, 'PUT', '/consult/app-review', await makeUser(), { rating: 3 });
            const pub = await call(publicApp, 'GET', '/consult/app-reviews');
            expect(pub.body.rating).toEqual({ average: 4, count: 3 });
            expect(JSON.stringify(pub.body)).not.toMatch(/userId|Test 7/);
        });
    });
});
