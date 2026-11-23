import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDb, makeDoctor, makeUser, resetConsultData, testDb } from './test/db';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('doctor changes wait for super-admin approval (real Postgres)', () => {
    let doctorApp: { url: string; close: () => Promise<void> };
    let adminApp: { url: string; close: () => Promise<void> };
    let service: typeof import('./doctors.service');
    let slots: typeof import('./slots');

    beforeAll(async () => {
        const routes = await import('./doctors.routes');
        service = await import('./doctors.service');
        slots = await import('./slots');
        doctorApp = await serve('/doctor', routes.doctorRoutes);
        adminApp = await serve('/admin', routes.consultAdminRoutes);
    });
    afterAll(async () => {
        await Promise.all([doctorApp?.close(), adminApp?.close()]);
        await testDb?.$disconnect();
    });
    beforeEach(resetConsultData);

    const call = (base: string, token: string, method: string, path: string, body?: unknown) =>
        fetch(`${base}${path}`, {
            method,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    const asDoctor = (token: string, method: string, path: string, body?: unknown) => call(doctorApp.url, token, method, `/doctor${path}`, body);
    const asAdmin = (token: string, method: string, path: string, body?: unknown) => call(adminApp.url, token, method, `/admin${path}`, body);

    /** An approved doctor working 10:00 to 12:00 IST on the weekday two days from now, 15-minute slots. */
    async function world() {
        const doctor = await makeDoctor();
        const admin = await makeUser('SUPER_ADMIN');
        const dayStart = slots.istDayStart(new Date(Date.now() + 2 * 86_400_000));
        const dow = new Date(dayStart.getTime() + 330 * 60_000).getUTCDay();
        await service.setAvailability(doctor.profile.id, [{ dayOfWeek: dow, startMinute: 600, endMinute: 720 }], 15);
        const at = (minute: number) => new Date(dayStart.getTime() + minute * 60_000);
        return { doctor, admin, dow, at, doctorToken: tokenFor(doctor.user), adminToken: tokenFor(admin) };
    }
    const daySlots = (doctorId: string, from: Date, to: Date) =>
        testDb.slot.findMany({ where: { doctorId, startsAt: { gte: from, lt: to } }, orderBy: { startsAt: 'asc' } });
    const liveWindows = async (doctorId: string) =>
        (await testDb.doctorAvailability.findMany({ where: { doctorId }, orderBy: { startMinute: 'asc' } }))
            .map(({ dayOfWeek, startMinute, endMinute }) => ({ dayOfWeek, startMinute, endMinute }));

    describe('weekly hours', () => {
        it('holds new hours for approval; the live hours and slots keep running', async () => {
            const w = await world();
            const before = await daySlots(w.doctor.profile.id, w.at(0), w.at(1440));
            const res = await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 900, endMinute: 960 }] });
            expect(res.status).toBe(202);
            const { request } = await res.json();
            expect(request).toMatchObject({ kind: 'AVAILABILITY', status: 'PENDING', payload: { slotMinutes: 15, windows: [{ startMinute: 900 }] } });
            expect(request.reviewedById).toBeUndefined();
            expect(await liveWindows(w.doctor.profile.id)).toEqual([{ dayOfWeek: w.dow, startMinute: 600, endMinute: 720 }]);
            expect((await daySlots(w.doctor.profile.id, w.at(0), w.at(1440))).map((s) => s.id)).toEqual(before.map((s) => s.id));
            // The doctor sees it on their profile.
            const me = await (await asDoctor(w.doctorToken, 'GET', '/me')).json();
            expect(me.changeRequests).toHaveLength(1);
            expect(me.changeRequests[0]).toMatchObject({ id: request.id, status: 'PENDING', previous: { windows: [{ startMinute: 600 }] } });
        });

        it('approval applies the hours, rebuilds free slots and keeps a booked slot outside the new hours', async () => {
            const w = await world();
            const bookedSlot = await testDb.slot.findFirstOrThrow({ where: { doctorId: w.doctor.profile.id, startsAt: w.at(630) } });
            await testDb.slot.update({ where: { id: bookedSlot.id }, data: { status: 'BOOKED' } });
            const { request } = await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 900, endMinute: 960 }] })).json();

            const res = await asAdmin(w.adminToken, 'POST', `/doctor-changes/${request.id}/approve`);
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ status: 'APPROVED', bookedKeptOutsideHours: 1 });

            expect(await liveWindows(w.doctor.profile.id)).toEqual([{ dayOfWeek: w.dow, startMinute: 900, endMinute: 960 }]);
            const day = await daySlots(w.doctor.profile.id, w.at(0), w.at(1440));
            expect(day.map((s) => [s.startsAt.getTime(), s.status])).toEqual([
                [w.at(630).getTime(), 'BOOKED'],
                ...[900, 915, 930, 945].map((m) => [w.at(m).getTime(), 'AVAILABLE']),
            ]);
            const audit = await testDb.adminAuditLog.findFirstOrThrow({ where: { action: 'DOCTOR_CHANGE_APPROVED', targetId: w.doctor.profile.id } });
            expect(audit).toMatchObject({ adminId: w.admin.id, oldValue: { windows: [{ startMinute: 600 }] } });
        });

        it('a slot-length change never puts a new slot across a booked one', async () => {
            const w = await world();
            // Booked 10:15 to 10:30 in the old 15-minute schedule.
            const booked = await testDb.slot.findFirstOrThrow({ where: { doctorId: w.doctor.profile.id, startsAt: w.at(615) } });
            await testDb.slot.update({ where: { id: booked.id }, data: { status: 'BOOKED' } });
            const { request } = await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', {
                windows: [{ dayOfWeek: w.dow, startMinute: 600, endMinute: 720 }], slotMinutes: 20,
            })).json();
            expect((await asAdmin(w.adminToken, 'POST', `/doctor-changes/${request.id}/approve`)).status).toBe(200);

            const day = await daySlots(w.doctor.profile.id, w.at(0), w.at(1440));
            const open = day.filter((s) => s.status === 'AVAILABLE');
            // 10:00 and 10:20 would overlap the booked 10:15; 10:40, 11:00, 11:20 and 11:40 are offered, all 20 minutes.
            expect(open.map((s) => (s.startsAt.getTime() - w.at(0).getTime()) / 60_000)).toEqual([640, 660, 680, 700]);
            expect(open.every((s) => s.endsAt.getTime() - s.startsAt.getTime() === 20 * 60_000)).toBe(true);
            for (const s of open) expect(s.startsAt < booked.endsAt && s.endsAt > booked.startsAt).toBe(false);
            expect((await testDb.slot.findUniqueOrThrow({ where: { id: booked.id } })).status).toBe('BOOKED');
            expect((await testDb.doctorProfile.findUniqueOrThrow({ where: { id: w.doctor.profile.id } })).slotMinutes).toBe(20);

            // The daily top-up does not bring the overlapping slots back either.
            await service.extendAllDoctorSlots();
            const again = (await daySlots(w.doctor.profile.id, w.at(0), w.at(1440))).filter((s) => s.status === 'AVAILABLE');
            expect(again.map((s) => s.id)).toEqual(open.map((s) => s.id));
        });

        it("an admin's direct slot-length edit rebuilds free slots at once", async () => {
            const w = await world();
            const res = await asAdmin(w.adminToken, 'PATCH', `/doctors/${w.doctor.profile.id}`, { slotMinutes: 30 });
            expect(res.status).toBe(200);
            const open = (await daySlots(w.doctor.profile.id, w.at(0), w.at(1440))).filter((s) => s.status === 'AVAILABLE');
            expect(open.map((s) => (s.startsAt.getTime() - w.at(0).getTime()) / 60_000)).toEqual([600, 630, 660, 690]);
            expect(open.every((s) => s.endsAt.getTime() - s.startsAt.getTime() === 30 * 60_000)).toBe(true);
        });

        it('rejecting keeps the old schedule and shows the doctor the reason', async () => {
            const w = await world();
            const { request } = await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [] })).json();
            expect((await asAdmin(w.adminToken, 'POST', `/doctor-changes/${request.id}/reject`, {})).status).toBe(400);
            const res = await asAdmin(w.adminToken, 'POST', `/doctor-changes/${request.id}/reject`, { reason: 'Please keep Tuesday open' });
            expect(res.status).toBe(200);
            expect(await liveWindows(w.doctor.profile.id)).toEqual([{ dayOfWeek: w.dow, startMinute: 600, endMinute: 720 }]);
            expect(await testDb.slot.count({ where: { doctorId: w.doctor.profile.id, status: 'AVAILABLE' } })).toBeGreaterThan(0);
            const me = await (await asDoctor(w.doctorToken, 'GET', '/me')).json();
            expect(me.changeRequests[0]).toMatchObject({ status: 'REJECTED', reviewReason: 'Please keep Tuesday open' });
        });

        it('a resend replaces the pending request, and the replaced one cannot be approved', async () => {
            const w = await world();
            const first = (await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 900, endMinute: 960 }] })).json()).request;
            const second = (await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 960, endMinute: 1020 }] })).json()).request;
            expect((await testDb.doctorChangeRequest.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('SUPERSEDED');
            expect(await testDb.doctorChangeRequest.count({ where: { doctorId: w.doctor.profile.id, status: 'PENDING' } })).toBe(1);

            const stale = await asAdmin(w.adminToken, 'POST', `/doctor-changes/${first.id}/approve`);
            expect(stale.status).toBe(409);
            expect((await stale.json()).error).toMatch(/newer version/);
            expect((await asAdmin(w.adminToken, 'POST', `/doctor-changes/${second.id}/approve`)).status).toBe(200);
            expect(await liveWindows(w.doctor.profile.id)).toEqual([{ dayOfWeek: w.dow, startMinute: 960, endMinute: 1020 }]);
        });

        it('two admins approving at once apply it once', async () => {
            const w = await world();
            const other = tokenFor(await makeUser('SUPER_ADMIN'));
            const { request } = await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 900, endMinute: 960 }] })).json();
            const results = await Promise.all([
                asAdmin(w.adminToken, 'POST', `/doctor-changes/${request.id}/approve`),
                asAdmin(other, 'POST', `/doctor-changes/${request.id}/approve`),
                asAdmin(other, 'POST', `/doctor-changes/${request.id}/reject`, { reason: 'Too late' }),
            ]);
            expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
            expect(await testDb.adminAuditLog.count({ where: { targetId: w.doctor.profile.id, action: { startsWith: 'DOCTOR_CHANGE_' } } })).toBe(1);
        });

        it('a resend racing an approval: the admin either approves the old one or gets 409, never a mix', async () => {
            const w = await world();
            const { request } = await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 900, endMinute: 960 }] })).json();
            const [approve, resend] = await Promise.all([
                asAdmin(w.adminToken, 'POST', `/doctor-changes/${request.id}/approve`),
                asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 960, endMinute: 1020 }] }),
            ]);
            expect(resend.status).toBe(202);
            const live = await liveWindows(w.doctor.profile.id);
            if (approve.status === 200) expect(live[0].startMinute).toBe(900);
            else {
                expect(approve.status).toBe(409);
                expect(live[0].startMinute).toBe(600);
            }
            expect(await testDb.doctorChangeRequest.count({ where: { doctorId: w.doctor.profile.id, status: 'PENDING' } })).toBe(1);
        });

        it('sending the live hours back withdraws the pending change', async () => {
            const w = await world();
            const { request } = await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 900, endMinute: 960 }] })).json();
            const res = await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 600, endMinute: 720 }], slotMinutes: 15 });
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ request: null });
            expect((await testDb.doctorChangeRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('WITHDRAWN');
        });

        it('refuses overlapping hours before saving anything', async () => {
            const w = await world();
            const res = await asDoctor(w.doctorToken, 'PUT', '/me/availability', {
                windows: [{ dayOfWeek: w.dow, startMinute: 600, endMinute: 700 }, { dayOfWeek: w.dow, startMinute: 650, endMinute: 720 }],
            });
            expect(res.status).toBe(400);
            expect(await testDb.doctorChangeRequest.count({ where: { doctorId: w.doctor.profile.id } })).toBe(0);
        });
    });

    describe('profile text', () => {
        it('bio, languages and experience wait for approval; gender applies at once', async () => {
            const w = await world();
            const res = await asDoctor(w.doctorToken, 'PATCH', '/me', { bio: 'Twenty years in family medicine', languages: ['English', 'Hindi'], experienceYears: 0, gender: 'Female' });
            expect(res.status).toBe(202);
            const body = await res.json();
            // experienceYears was already 0, so only the two real changes are in the request.
            expect(body.request.payload).toEqual({ bio: 'Twenty years in family medicine', languages: ['English', 'Hindi'] });
            expect(body.request.previous).toEqual({ bio: null, languages: ['English'] });
            expect(body.doctor).toMatchObject({ gender: 'Female', bio: null, languages: ['English'] });

            expect((await asAdmin(w.adminToken, 'POST', `/doctor-changes/${body.request.id}/approve`)).status).toBe(200);
            expect(await testDb.doctorProfile.findUniqueOrThrow({ where: { id: w.doctor.profile.id } })).toMatchObject({
                bio: 'Twenty years in family medicine', languages: ['English', 'Hindi'], gender: 'Female',
            });
        });

        it('gender alone saves at once with no request', async () => {
            const w = await world();
            const res = await asDoctor(w.doctorToken, 'PATCH', '/me', { gender: 'Male' });
            expect(res.status).toBe(200);
            expect((await res.json()).request).toBeNull();
            expect(await testDb.doctorChangeRequest.count({ where: { doctorId: w.doctor.profile.id } })).toBe(0);
        });
    });

    describe('withdraw and access', () => {
        it('the doctor can withdraw their own pending change, not another doctor\'s', async () => {
            const w = await world();
            const other = await world();
            const { request } = await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [] })).json();
            expect((await asDoctor(other.doctorToken, 'DELETE', `/me/changes/${request.id}`)).status).toBe(409);
            expect((await asDoctor(w.doctorToken, 'DELETE', `/me/changes/${request.id}`)).status).toBe(200);
            expect((await testDb.doctorChangeRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('WITHDRAWN');
            expect((await asAdmin(w.adminToken, 'POST', `/doctor-changes/${request.id}/approve`)).status).toBe(409);
        });

        it('only a super admin sees or reviews the queue', async () => {
            const w = await world();
            const { request } = await (await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [] })).json();
            const user = tokenFor(await makeUser());
            expect((await asAdmin(user, 'GET', '/doctor-changes')).status).toBe(403);
            expect((await asAdmin(w.doctorToken, 'POST', `/doctor-changes/${request.id}/approve`)).status).toBe(403);
            expect((await testDb.doctorChangeRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('PENDING');
        });

        it('the queue shows live values, booked slots outside the new hours, and recent leave', async () => {
            const w = await world();
            const booked = await testDb.slot.findFirstOrThrow({ where: { doctorId: w.doctor.profile.id, startsAt: w.at(600) } });
            await testDb.slot.update({ where: { id: booked.id }, data: { status: 'BOOKED' } });
            await asDoctor(w.doctorToken, 'PUT', '/me/availability', { windows: [{ dayOfWeek: w.dow, startMinute: 900, endMinute: 960 }] });
            await service.addLeave(w.doctor.profile.id, w.at(540), w.at(780), 'Family emergency');

            const res = await asAdmin(w.adminToken, 'GET', '/doctor-changes');
            expect(res.status).toBe(200);
            const queue = await res.json();
            const mine = queue.requests.find((r: any) => r.doctorId === w.doctor.profile.id);
            expect(mine).toMatchObject({ live: { slotMinutes: 15, windows: [{ startMinute: 600, endMinute: 720 }] }, bookedOutsideNewHours: 1 });
            expect(mine.reviewedById).toBeUndefined();
            const leave = queue.recentLeave.find((l: any) => l.doctorId === w.doctor.profile.id);
            expect(leave).toMatchObject({ reason: 'Family emergency', bookedInside: 1, doctor: { displayName: 'Dr Test' } });
        });
    });
});
