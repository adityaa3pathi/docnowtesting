/**
 * Dummy doctors for testing the consultation flow. Safe to re-run.
 * Refuses to run in production. Dummy mobiles are 8000000001 to 8000000005.
 */
import { PrismaClient } from '@prisma/client';
import { extendAllDoctorSlots } from '../src/modules/consultations/doctors.service';

const prisma = new PrismaClient();

const SPECIALTIES = ['General Physician', 'Dermatologist', 'Pediatrician', 'Diabetologist', 'Orthopedist'];

const DOCTORS = [
    { mobile: '8000000001', name: 'Dr. Asha Sharma', specialty: 'General Physician', fee: 499, years: 12, languages: ['Hindi', 'English'] },
    { mobile: '8000000002', name: 'Dr. Rohan Mehta', specialty: 'Dermatologist', fee: 699, years: 8, languages: ['English', 'Gujarati'] },
    { mobile: '8000000003', name: 'Dr. Neha Iyer', specialty: 'Pediatrician', fee: 599, years: 10, languages: ['English', 'Tamil', 'Hindi'] },
    { mobile: '8000000004', name: 'Dr. Imran Khan', specialty: 'Diabetologist', fee: 799, years: 15, languages: ['Hindi', 'English', 'Urdu'] },
    { mobile: '8000000005', name: 'Dr. Priya Nair', specialty: 'Orthopedist', fee: 899, years: 9, languages: ['English', 'Malayalam'] },
];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed dummy doctors in production');

    const specialties = new Map<string, string>();
    for (const name of SPECIALTIES) {
        const s = await prisma.specialty.upsert({ where: { name }, update: {}, create: { name, slug: slugify(name) } });
        specialties.set(name, s.id);
    }

    for (const [i, d] of DOCTORS.entries()) {
        const user = await prisma.user.upsert({
            where: { mobile: d.mobile },
            update: { role: 'DOCTOR' },
            create: { mobile: d.mobile, name: d.name, role: 'DOCTOR', isVerified: true },
        });
        const profile = await prisma.doctorProfile.upsert({
            where: { userId: user.id },
            update: {},
            create: {
                userId: user.id,
                specialtyId: specialties.get(d.specialty)!,
                displayName: d.name,
                qualification: 'MBBS, MD',
                registrationNumber: `DUMMY-${1000 + i}`,
                registrationCouncil: 'Dummy Medical Council',
                experienceYears: d.years,
                languages: d.languages,
                consultationFee: d.fee,
                slotMinutes: 15,
                status: 'APPROVED',
                reviewedAt: new Date(),
            },
        });
        const hasHours = await prisma.doctorAvailability.count({ where: { doctorId: profile.id } });
        if (!hasHours) {
            const windows = [1, 2, 3, 4, 5, 6].flatMap((dayOfWeek) => [
                { doctorId: profile.id, dayOfWeek, startMinute: 600, endMinute: 840 },
                { doctorId: profile.id, dayOfWeek, startMinute: 1020, endMinute: 1200 },
            ]);
            await prisma.doctorAvailability.createMany({ data: windows });
        }
    }

    console.log('Slots:', await extendAllDoctorSlots());
    console.log('Dummy doctors ready. Log in with mobiles 8000000001 to 8000000005.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
