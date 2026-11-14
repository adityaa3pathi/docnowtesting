import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { describeDb, makeDoctor, makeSlot, makeUser, resetConsultData, testDb } from './test/db';
import { DOCTOR_GENDERS } from './doctors.types';
import { serve, tokenFor, useTestJwtSecret } from './test/http';

useTestJwtSecret();

describeDb('doctor gender and next slot (real Postgres)', () => {
    let leadMinutes: number;
    let doctorApp: { url: string; close: () => Promise<void> };
    let publicApp: { url: string; close: () => Promise<void> };

    beforeAll(async () => {
        leadMinutes = (await import('./consultations.policy')).DEFAULT_RULES.minLeadMinutes;
        const routes = await import('./doctors.routes');
        doctorApp = await serve('/doctor', routes.doctorRoutes);
        publicApp = await serve('/consult', routes.consultPublicRoutes);
    });
    afterAll(async () => {
        await Promise.all([doctorApp?.close(), publicApp?.close()]);
        await testDb?.$disconnect();
    });
    beforeEach(resetConsultData);

    const specialty = () => testDb.specialty.upsert({
        where: { name: 'Test Specialty' }, update: {}, create: { name: 'Test Specialty', slug: 'test-specialty' },
    });

    async function application(over: Record<string, unknown> = {}) {
        const s = await specialty();
        return {
            displayName: 'Dr Gendered', specialtyId: s.id, qualification: 'MBBS', registrationCouncil: 'Test Council',
            registrationNumber: `G-${randomUUID().slice(0, 8)}`, experienceYears: 3, languages: ['English'], ...over,
        };
    }
    async function register(body: unknown) {
        const user = await makeUser();
        const res = await fetch(`${doctorApp.url}/doctor/register`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(user)}` }, body: JSON.stringify(body),
        });
        return { user, res };
    }

    describe('gender on registration', () => {
        it('refuses an application with no gender and keeps no profile', async () => {
            const { user, res } = await register(await application());
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe('Please choose your gender');
            expect(await testDb.doctorProfile.findUnique({ where: { userId: user.id } })).toBeNull();
        });

        it('accepts every allowed gender and saves it on the row', async () => {
            for (const gender of DOCTOR_GENDERS) {
                const { user, res } = await register(await application({ gender }));
                expect(res.status).toBe(201);
                const row = await testDb.doctorProfile.findUniqueOrThrow({ where: { userId: user.id } });
                expect(row.gender).toBe(gender);
                // Fee stays 0 so the new profile is unbookable until an admin sets one.
                expect(row).toMatchObject({ status: 'PENDING', consultationFee: 0 });
            }
        });

        it('refuses a gender outside the allowed list', async () => {
            for (const gender of ['male', 'FEMALE', 'Unknown', '', 7, null]) {
                const { user, res } = await register(await application({ gender }));
                expect(res.status).toBe(400);
                expect(await testDb.doctorProfile.findUnique({ where: { userId: user.id } })).toBeNull();
            }
        });
    });

    describe('public doctor list', () => {
        async function listed(ids: string[]) {
            const res = await fetch(`${publicApp.url}/consult/doctors`);
            expect(res.status).toBe(200);
            const all = (await res.json()) as { id: string; gender: string | null; nextSlotAt: string | null }[];
            return ids.map((id) => all.find((d) => d.id === id));
        }
        async function gendered(gender: string) {
            const d = await makeDoctor();
            await testDb.doctorProfile.update({ where: { id: d.profile.id }, data: { gender } });
            return d;
        }

        it('returns each doctor\'s gender and earliest bookable time, null when none is open', async () => {
            const withSlot = await gendered('Female');
            const without = await gendered('Male');
            const slot = await makeSlot(withSlot.profile.id, 24 * 60);
            const [a, b] = await listed([withSlot.profile.id, without.profile.id]);
            expect(a).toMatchObject({ gender: 'Female', nextSlotAt: slot.startsAt.toISOString() });
            expect(b).toMatchObject({ gender: 'Male', nextSlotAt: null });
        });

        it('picks the earliest free slot, skipping ones inside the lead time, booked or blocked', async () => {
            const d = await gendered('Other');
            await makeSlot(d.profile.id, Math.max(1, leadMinutes - 10));
            await makeSlot(d.profile.id, 120, 'BOOKED');
            await makeSlot(d.profile.id, 180, 'BLOCKED');
            const bookable = await makeSlot(d.profile.id, 240);
            await makeSlot(d.profile.id, 300);
            const [row] = await listed([d.profile.id]);
            expect(row).toMatchObject({ nextSlotAt: bookable.startsAt.toISOString() });
        });

        it('offers nothing when every slot is inside the lead time or already taken', async () => {
            const d = await gendered('Female');
            await makeSlot(d.profile.id, Math.max(1, leadMinutes - 10));
            await makeSlot(d.profile.id, 120, 'BOOKED');
            const [row] = await listed([d.profile.id]);
            expect(row).toMatchObject({ nextSlotAt: null });
        });

        it('leaves a doctor who is not approved out of the list entirely', async () => {
            const pending = await makeDoctor({ status: 'PENDING' });
            await makeSlot(pending.profile.id, 24 * 60);
            expect(await listed([pending.profile.id])).toEqual([undefined]);
        });

        it('keeps gender and nextSlotAt when the list is filtered by specialty', async () => {
            const d = await gendered('Male');
            const slot = await makeSlot(d.profile.id, 90);
            const res = await fetch(`${publicApp.url}/consult/doctors?specialtyId=${d.profile.specialtyId}`);
            const row = ((await res.json()) as any[]).find((x) => x.id === d.profile.id);
            expect(row).toMatchObject({ gender: 'Male', nextSlotAt: slot.startsAt.toISOString() });
        });
    });
});
