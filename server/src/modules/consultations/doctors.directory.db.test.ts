import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeDb, makeConsultation, makeDoctor, makePatient, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { serve, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('public doctor list: filters, search, Online now, paging (real Postgres)', () => {
    let app: { url: string; close: () => Promise<void> };
    let instant: typeof import('./consultations.instant');
    let gp: { id: string };

    beforeAll(async () => {
        const routes = await import('./doctors.routes');
        instant = await import('./consultations.instant');
        app = await serve('/consult', routes.consultPublicRoutes);
        gp = await testDb.specialty.upsert({ where: { name: 'General Physician' }, update: { slug: 'general-physician', isActive: true }, create: { name: 'General Physician', slug: 'general-physician' } });
    });
    afterAll(async () => {
        await app?.close();
        await testDb?.$disconnect();
    });
    beforeEach(resetConsultData);

    // Doctor rows outlive each test, so every test lists its own fresh specialty.
    async function specialty() {
        const tag = randomUUID().slice(0, 8);
        return testDb.specialty.create({ data: { name: `Dir ${tag}`, slug: `dir-${tag}` } });
    }
    async function doctor(specialtyId: string, data: { displayName?: string; languages?: string[]; gender?: string; experienceYears?: number; consultationFee?: number; status?: 'APPROVED' | 'PENDING' | 'SUSPENDED' } = {}) {
        const d = await makeDoctor({ status: data.status });
        await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { specialtyId, ...data, status: data.status ?? 'APPROVED' } });
        return d.profile.id;
    }
    const list = async (qs: string) => {
        const res = await fetch(`${app.url}/consult/doctors${qs}`);
        return { status: res.status, body: await res.json() };
    };
    const ids = async (qs: string) => (await list(qs)).body.map((d: any) => d.id);

    it('keeps the plain array without page, approved doctors only, with next free time and online state', async () => {
        const s = await specialty();
        const a = await doctor(s.id, { displayName: 'Dr Asha' });
        await doctor(s.id, { status: 'PENDING' });
        await doctor(s.id, { status: 'SUSPENDED' });
        const slot = await makeSlot(a, 24 * 60);
        const { status, body } = await list(`?specialtyId=${s.id}`);
        expect(status).toBe(200);
        expect(Array.isArray(body)).toBe(true);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ id: a, nextSlotAt: slot.startsAt.toISOString(), onlineNow: false });
        // Public: nothing that identifies the doctor's account or registration.
        expect(Object.keys(body[0]).sort()).toEqual([
            'bio', 'consultationFee', 'displayName', 'experienceYears', 'gender', 'id', 'languages',
            'nextSlotAt', 'onlineNow', 'photoUrl', 'qualification', 'rating', 'slotMinutes', 'specialty',
        ]);
    });

    it('searches by part of the name in any case, with or without the Dr title', async () => {
        const s = await specialty();
        const anil = await doctor(s.id, { displayName: 'Dr Anil Mehta' });
        await doctor(s.id, { displayName: 'Dr Priya Shah' });
        const base = `?specialtyId=${s.id}`;
        expect(await ids(`${base}&q=aNi`)).toEqual([anil]);
        expect(await ids(`${base}&q=Dr.%20Anil`)).toEqual([anil]);
        expect(await ids(`${base}&q=mehta`)).toEqual([anil]);
        expect(await ids(`${base}&q=dr`)).toHaveLength(2);
        expect(await ids(`${base}&q=%20%20`)).toHaveLength(2);
        expect(await ids(`${base}&q=nobody`)).toEqual([]);
        // LIKE wildcards are plain text, not patterns.
        expect(await ids(`${base}&q=%25`)).toEqual([]);
        expect(await ids(`${base}&q=_`)).toEqual([]);
        const odd = await doctor(s.id, { displayName: 'Dr 100% Fit_Ok' });
        expect(await ids(`${base}&q=0%25%20fit_`)).toEqual([odd]);
    });

    it('filters by any chosen language, gender, minimum experience and maximum fee', async () => {
        const s = await specialty();
        const hindi = await doctor(s.id, { languages: ['Hindi'], gender: 'Female', experienceYears: 12, consultationFee: 400 });
        const both = await doctor(s.id, { languages: ['English', 'Marathi'], gender: 'Male', experienceYears: 5, consultationFee: 800 });
        await doctor(s.id, { languages: ['Tamil'], gender: null as any, experienceYears: 20, consultationFee: 1200 });
        const base = `?specialtyId=${s.id}`;
        expect(new Set(await ids(`${base}&lang=Hindi,Marathi`))).toEqual(new Set([hindi, both]));
        expect(await ids(`${base}&gender=Female`)).toEqual([hindi]);
        expect(new Set(await ids(`${base}&minExperience=12`)).has(both)).toBe(false);
        expect(await ids(`${base}&maxFee=800&minExperience=5&gender=Male`)).toEqual([both]);
        expect(await ids(`${base}&maxFee=399`)).toEqual([]);
    });

    it('"Online now" keeps only GPs who are online and free: not offline, stale, in a call or ringing', async () => {
        const now = new Date();
        const mk = async (name: string) => {
            const id = await doctor(gp.id, { displayName: name });
            await instant.goOnline(id, { db: testDb, now });
            return id;
        };
        const free = await mk('Dr Free');
        const inCall = await mk('Dr In Call');
        const stale = await mk('Dr Stale');
        const ringing = await mk('Dr Ringing');
        const offline = await doctor(gp.id, { displayName: 'Dr Offline' });

        const user = await makeUser();
        const patient = await makePatient(user.id);
        const slot = await makeSlot(inCall, -2, 'BOOKED');
        await makeConsultation({ userId: user.id, patientId: patient.id, doctorId: inCall, slotId: slot.id, startsAt: slot.startsAt, status: 'IN_PROGRESS' });
        await testDb.doctorPresence.updateMany({ where: { doctorId: stale }, data: { lastSeenAt: new Date(now.getTime() - 5 * 60_000) } });
        await testDb.instantRequest.create({
            data: { userId: user.id, patientId: patient.id, reason: 'Fever', status: 'RINGING', doctorId: ringing, searchEndsAt: new Date(now.getTime() + 600_000), ringExpiresAt: new Date(now.getTime() + 60_000) },
        });

        const all = (await list(`?specialtyId=${gp.id}`)).body as any[];
        const online = new Map(all.map((d) => [d.id, d.onlineNow]));
        expect([free, inCall, stale, ringing, offline].map((id) => online.get(id))).toEqual([true, false, false, false, false]);
        expect(await ids(`?specialtyId=${gp.id}&now=1`)).toEqual([free]);
        expect(await ids(`?now=true&q=Dr%20Free`)).toEqual([free]);
        // Offline again: gone from the filter at once.
        await instant.goOffline(free, { db: testDb, now });
        expect(await ids(`?specialtyId=${gp.id}&now=1`)).toEqual([]);
    });

    it('sorts: recommended puts online doctors first, then the soonest free time, then experience', async () => {
        const now = new Date();
        const s = await specialty();
        const later = await doctor(s.id, { displayName: 'Dr B Later', experienceYears: 30 });
        const sooner = await doctor(s.id, { displayName: 'Dr C Sooner', experienceYears: 1 });
        const none = await doctor(s.id, { displayName: 'Dr D None', experienceYears: 40 });
        const onlineGp = await doctor(gp.id, { displayName: 'Dr A Online' });
        await makeSlot(later, 48 * 60);
        await makeSlot(sooner, 24 * 60);
        expect(await ids(`?specialtyId=${s.id}&sort=recommended`)).toEqual([sooner, later, none]);
        expect(await ids(`?specialtyId=${s.id}&sort=experience`)).toEqual([none, later, sooner]);

        await instant.goOnline(onlineGp, { db: testDb, now });
        const mixed = (await ids('?sort=recommended')) as string[];
        expect(mixed[0]).toBe(onlineGp);
        expect(mixed.indexOf(sooner)).toBeLessThan(mixed.indexOf(later));
        // Paged with no sort: recommended. Plain array with no sort: the old A–Z order, online or not.
        expect((await list('?page=1&pageSize=48')).body.items[0].id).toBe(onlineGp);
        expect(await ids(`?specialtyId=${s.id}`)).toEqual([later, sooner, none]);
        const byName = await testDb.doctorProfile.findMany({ where: { status: 'APPROVED' }, orderBy: { displayName: 'asc' }, select: { displayName: true } });
        expect((await list('')).body.map((d: any) => d.displayName)).toEqual(byName.map((d) => d.displayName));
    });

    it('pages with a total and the specialty\'s languages, stable and without gaps', async () => {
        const s = await specialty();
        const made: string[] = [];
        for (let i = 0; i < 5; i++) made.push(await doctor(s.id, { displayName: `Dr Page ${i}`, consultationFee: 500, languages: i < 2 ? ['Hindi', 'English'] : ['English'] }));
        const base = `?specialtyId=${s.id}&sort=fee_low&pageSize=2`;
        const p1 = (await list(`${base}&page=1`)).body;
        const p2 = (await list(`${base}&page=2`)).body;
        const p3 = (await list(`${base}&page=3`)).body;
        expect(p1).toMatchObject({ total: 5, page: 1, pageSize: 2, languages: ['English', 'Hindi'], onlineSpecialtyId: gp.id });
        const seen = [...p1.items, ...p2.items, ...p3.items].map((d: any) => d.id);
        expect(seen).toHaveLength(5);
        expect(new Set(seen)).toEqual(new Set(made));
        expect((await list(`${base}&page=9`)).body).toMatchObject({ items: [], total: 5 });
        // The language menu ignores the other filters, so picking one never empties it.
        expect((await list(`?specialtyId=${s.id}&lang=Hindi&page=1`)).body).toMatchObject({ total: 2, languages: ['English', 'Hindi'] });
    });

    it('rejects bad parameters instead of guessing', async () => {
        for (const qs of [
            '?specialtyId=not-a-uuid', `?q=${'a'.repeat(81)}`, '?gender=Other', '?minExperience=-1', '?maxFee=0',
            '?now=maybe', '?sort=cheapest', '?page=0', '?pageSize=49', `?lang=${Array.from({ length: 11 }, (_, i) => `L${i}`).join(',')}`,
        ]) {
            expect((await list(qs)).status, qs).toBe(400);
        }
    });
});
