/**
 * Doctor Routes
 *
 * Public: specialties and approved doctors.
 * Signed-in user: register as a doctor, see own application.
 * Doctor (approved): own profile, hours, leave, slot blocking.
 * Super admin: create doctors, edit, approve, reject, suspend, specialties.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { requireDoctor } from '../../middleware/requireDoctor';
import { consultCsrfGuard } from '../../middleware/consultCsrf';
import { getActivePolicy } from './consultations.policy.service';
import { requireSuperAdmin } from '../../middleware/adminAuth';
import { rateLimiter } from '../../middleware/rateLimiter';
import { getClientIP } from '../../utils/adminHelpers';
import {
    adminCreateDoctorSchema, adminUpdateDoctorSchema, availabilitySchema, doctorSelfUpdateSchema,
    leaveSchema, registerDoctorSchema, reviewReasonSchema, specialtySchema,
} from './doctors.types';
import { DoctorError } from './doctors.status';
import { doctorListQuery, listDoctorConsultations } from './doctors.consultations';
import { policyRoutes } from './consultations.policy.routes';
import { reviewRoutes } from './consultations.review.routes';
import { doctorJoin, endConsultation } from './consultations.room';
import { getDoctorRecord, issuePrescription, noteSchema, prescriptionSchema, reissuePrescription, reissueSchema, saveNotes } from './consultations.prescription';
import { renderPrescriptionPdf } from './consultations.prescriptionPdf';
import { appointmentsQuery, getAppointment, listAppointments } from './consultations.appointments';
import {
    addLeave, adminCreateDoctor, registerDoctor, removeLeave, resubmitDoctor, reviewDoctor, setAvailability, setSlotBlocked,
} from './doctors.service';

function fail(res: Response, e: unknown, label: string) {
    if (e instanceof DoctorError) return res.status(e.status).json({ error: e.message });
    console.error(`[Doctors] ${label} failed:`, e);
    return res.status(500).json({ error: 'Internal Server Error' });
}

function bad(res: Response, parse: { success: false; error: z.ZodError }) {
    return res.status(400).json({ error: parse.error.issues[0].message });
}

async function audit(req: AuthRequest, action: string, targetId: string, newValue?: object) {
    await prisma.adminAuditLog.create({
        data: {
            adminId: req.adminId!,
            adminName: req.adminName || 'Admin',
            action,
            entity: 'DoctorProfile',
            targetId,
            newValue: newValue as any,
            ipAddress: getClientIP(req),
        },
    });
}

const publicDoctorSelect = {
    id: true, displayName: true, photoUrl: true, qualification: true, experienceYears: true,
    languages: true, bio: true, consultationFee: true, slotMinutes: true,
    specialty: { select: { id: true, name: true, slug: true } },
} as const;

// ── Public ──────────────────────────────────────────────

export const consultPublicRoutes = Router();

consultPublicRoutes.get('/specialties', async (_req, res) => {
    try {
        res.json(await prisma.specialty.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }));
    } catch (e) { fail(res, e, 'list specialties'); }
});

consultPublicRoutes.get('/doctors', async (req, res) => {
    try {
        const specialtyId = typeof req.query.specialtyId === 'string' ? req.query.specialtyId : undefined;
        res.json(await prisma.doctorProfile.findMany({
            where: { status: 'APPROVED', specialtyId },
            select: publicDoctorSelect,
            orderBy: { displayName: 'asc' },
        }));
    } catch (e) { fail(res, e, 'list doctors'); }
});

consultPublicRoutes.get('/doctors/:id', async (req, res) => {
    try {
        const doctor = await prisma.doctorProfile.findFirst({
            where: { id: req.params.id, status: 'APPROVED' },
            select: { ...publicDoctorSelect, registrationNumber: true, registrationCouncil: true },
        });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
        res.json(doctor);
    } catch (e) { fail(res, e, 'get doctor'); }
});

consultPublicRoutes.get('/doctors/:id/slots', async (req, res) => {
    try {
        // Slots inside the lead time cannot be booked, so they are not offered.
        const { rules } = await getActivePolicy();
        const earliest = new Date(Date.now() + rules.minLeadMinutes * 60_000);
        const slots = await prisma.slot.findMany({
            where: { doctorId: req.params.id, status: 'AVAILABLE', startsAt: { gt: earliest }, doctor: { status: 'APPROVED' } },
            select: { id: true, startsAt: true, endsAt: true },
            orderBy: { startsAt: 'asc' },
        });
        res.json(slots);
    } catch (e) { fail(res, e, 'list slots'); }
});

// ── Doctor (self) ───────────────────────────────────────

export const doctorRoutes = Router();

doctorRoutes.post('/register', authMiddleware, rateLimiter(5, 3600, 'doctor_register'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = registerDoctorSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        res.status(201).json(await registerDoctor(req.userId!, parse.data));
    } catch (e) { fail(res, e, 'register'); }
});

doctorRoutes.post('/resubmit', authMiddleware, consultCsrfGuard, rateLimiter(5, 3600, 'doctor_resubmit'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = registerDoctorSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        res.json(await resubmitDoctor(req.userId!, parse.data));
    } catch (e) { fail(res, e, 'resubmit'); }
});

// Open to pending and rejected doctors so they can see their application status.
doctorRoutes.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const doctor = await prisma.doctorProfile.findUnique({
            where: { userId: req.userId },
            include: { specialty: true, availability: true },
        });
        if (!doctor) return res.status(404).json({ error: 'No doctor profile' });
        res.json(doctor);
    } catch (e) { fail(res, e, 'get me'); }
});

const mine = [authMiddleware, requireDoctor] as const;

async function myDoctorId(req: AuthRequest) {
    const d = await prisma.doctorProfile.findUnique({ where: { userId: req.userId }, select: { id: true, status: true } });
    if (!d || d.status !== 'APPROVED') throw new DoctorError(403, 'Doctor profile is not approved');
    return d.id;
}

doctorRoutes.patch('/me', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const parse = doctorSelfUpdateSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = await myDoctorId(req);
        res.json(await prisma.doctorProfile.update({ where: { id }, data: parse.data }));
    } catch (e) { fail(res, e, 'update me'); }
});

doctorRoutes.put('/me/availability', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const parse = availabilitySchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = await myDoctorId(req);
        res.json(await setAvailability(id, parse.data.windows, parse.data.slotMinutes));
    } catch (e) { fail(res, e, 'set availability'); }
});

doctorRoutes.get('/me/slots', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const id = await myDoctorId(req);
        res.json(await prisma.slot.findMany({
            where: { doctorId: id, startsAt: { gt: new Date() } },
            orderBy: { startsAt: 'asc' },
        }));
    } catch (e) { fail(res, e, 'list my slots'); }
});

doctorRoutes.get('/me/consultations', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const parse = doctorListQuery.safeParse(req.query);
        if (!parse.success) return bad(res, parse);
        const id = await myDoctorId(req);
        res.json(await listDoctorConsultations(id, parse.data));
    } catch (e) { fail(res, e, 'list my consultations'); }
});

doctorRoutes.post('/me/slots/:id/block', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        await setSlotBlocked(await myDoctorId(req), req.params.id as string, true);
        res.json({ success: true });
    } catch (e) { fail(res, e, 'block slot'); }
});

doctorRoutes.post('/me/slots/:id/unblock', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        await setSlotBlocked(await myDoctorId(req), req.params.id as string, false);
        res.json({ success: true });
    } catch (e) { fail(res, e, 'unblock slot'); }
});

doctorRoutes.get('/me/leave', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const id = await myDoctorId(req);
        res.json(await prisma.doctorLeave.findMany({ where: { doctorId: id, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } }));
    } catch (e) { fail(res, e, 'list leave'); }
});

doctorRoutes.post('/me/leave', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const parse = leaveSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = await myDoctorId(req);
        const { startsAt, endsAt, reason } = parse.data;
        res.status(201).json(await addLeave(id, new Date(startsAt), new Date(endsAt), reason));
    } catch (e) { fail(res, e, 'add leave'); }
});

doctorRoutes.delete('/me/leave/:id', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        await removeLeave(await myDoctorId(req), req.params.id as string);
        res.json({ success: true });
    } catch (e) { fail(res, e, 'remove leave'); }
});

// ── Doctor: the consultation room ───────────────────────

const mineWrite = [...mine, consultCsrfGuard] as const;
const consultId = (req: AuthRequest) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new DoctorError(404, 'Not found');
    return id.data;
};

doctorRoutes.get('/me/consultations/:id', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await getDoctorRecord(await myDoctorId(req), consultId(req)));
    } catch (e) { fail(res, e, 'get consultation'); }
});

doctorRoutes.post('/me/consultations/:id/join', ...mineWrite, rateLimiter(20, 60, 'doctor_join'), async (req: AuthRequest, res: Response) => {
    try {
        res.json(await doctorJoin(await myDoctorId(req), req.userId!, consultId(req)));
    } catch (e) { fail(res, e, 'join'); }
});

doctorRoutes.post('/me/consultations/:id/end', ...mineWrite, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await endConsultation(await myDoctorId(req), consultId(req)));
    } catch (e) { fail(res, e, 'end'); }
});

doctorRoutes.put('/me/consultations/:id/notes', ...mineWrite, async (req: AuthRequest, res: Response) => {
    try {
        const parse = noteSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        res.json(await saveNotes(await myDoctorId(req), consultId(req), parse.data));
    } catch (e) { fail(res, e, 'save notes'); }
});

doctorRoutes.post('/me/consultations/:id/prescription', ...mineWrite, rateLimiter(10, 60, 'doctor_rx'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = prescriptionSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        res.status(201).json(await issuePrescription(await myDoctorId(req), consultId(req), parse.data));
    } catch (e) { fail(res, e, 'issue prescription'); }
});

doctorRoutes.post('/me/consultations/:id/prescription/reissue', ...mineWrite, rateLimiter(10, 60, 'doctor_rx'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = reissueSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        res.status(201).json(await reissuePrescription(await myDoctorId(req), consultId(req), parse.data));
    } catch (e) { fail(res, e, 'reissue prescription'); }
});

doctorRoutes.get('/me/consultations/:id/prescription.pdf', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const record = await getDoctorRecord(await myDoctorId(req), consultId(req));
        if (!record.prescription) throw new DoctorError(404, 'No prescription yet');
        const pdf = await renderPrescriptionPdf(record.prescription);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="docnow-prescription-${record.id.slice(0, 8)}.pdf"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(pdf);
    } catch (e) { fail(res, e, 'prescription pdf'); }
});

// ── Super admin ─────────────────────────────────────────

/** Doctor no-shows in the last 30 days, counted after the refund moves them on to REFUNDED too. */
async function doctorNoShowCounts(doctorIds: string[]) {
    const rows = await prisma.consultation.findMany({
        where: {
            doctorId: { in: doctorIds },
            startsAt: { gte: new Date(Date.now() - 30 * 24 * 3_600_000) },
            OR: [{ status: 'NO_SHOW_DOCTOR' }, { refunds: { some: { reason: 'DOCTOR_NO_SHOW' } } }],
        },
        select: { doctorId: true },
    });
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.doctorId, (counts.get(r.doctorId) ?? 0) + 1);
    return counts;
}

export const consultAdminRoutes = Router();
consultAdminRoutes.use('/policy', policyRoutes);
consultAdminRoutes.use(reviewRoutes);
const admin = [authMiddleware, requireSuperAdmin] as const;

consultAdminRoutes.get('/doctors', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const valid = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];
        const doctors = await prisma.doctorProfile.findMany({
            where: { status: status && valid.includes(status) ? (status as any) : undefined },
            include: { specialty: true, user: { select: { mobile: true } } },
            orderBy: { createdAt: 'desc' },
        });
        const noShows = await doctorNoShowCounts(doctors.map((d) => d.id));
        res.json(doctors.map((d) => ({ ...d, noShows30d: noShows.get(d.id) ?? 0 })));
    } catch (e) { fail(res, e, 'admin list'); }
});

consultAdminRoutes.get('/doctors/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const doctor = await prisma.doctorProfile.findUnique({
            where: { id: req.params.id as string },
            include: { specialty: true, availability: true, user: { select: { mobile: true, email: true } } },
        });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
        res.json(doctor);
    } catch (e) { fail(res, e, 'admin get'); }
});

consultAdminRoutes.post('/doctors', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = adminCreateDoctorSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const doctor = await adminCreateDoctor(req.adminId!, parse.data);
        await audit(req, 'DOCTOR_CREATE', doctor!.id);
        res.status(201).json(doctor);
    } catch (e) { fail(res, e, 'admin create'); }
});

consultAdminRoutes.patch('/doctors/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = adminUpdateDoctorSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = req.params.id as string;
        const updated = await prisma.doctorProfile.update({ where: { id }, data: parse.data });
        await audit(req, 'DOCTOR_UPDATE', id, parse.data);
        res.json(updated);
    } catch (e) { fail(res, e, 'admin update'); }
});

for (const [path, to, needsReason] of [
    ['approve', 'APPROVED', false],
    ['reject', 'REJECTED', true],
    ['suspend', 'SUSPENDED', true],
] as const) {
    consultAdminRoutes.post(`/doctors/:id/${path}`, ...admin, async (req: AuthRequest, res: Response) => {
        try {
            let reason: string | undefined;
            if (needsReason) {
                const parse = reviewReasonSchema.safeParse(req.body);
                if (!parse.success) return bad(res, parse);
                reason = parse.data.reason;
            }
            const id = req.params.id as string;
            const updated = await reviewDoctor(req.adminId!, id, to, reason);
            await audit(req, `DOCTOR_${to}`, id, { reason });
            res.json(updated);
        } catch (e) { fail(res, e, `admin ${path}`); }
    });
}

consultAdminRoutes.get('/specialties', ...admin, async (_req, res) => {
    try {
        res.json(await prisma.specialty.findMany({ orderBy: { name: 'asc' } }));
    } catch (e) { fail(res, e, 'admin list specialties'); }
});

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

consultAdminRoutes.post('/specialties', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = specialtySchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const created = await prisma.specialty.create({ data: { ...parse.data, slug: slugify(parse.data.name) } });
        res.status(201).json(created);
    } catch (e: any) {
        if (e?.code === 'P2002') return res.status(409).json({ error: 'Specialty already exists' });
        fail(res, e, 'create specialty');
    }
});

consultAdminRoutes.patch('/specialties/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = specialtySchema.partial().safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        res.json(await prisma.specialty.update({ where: { id: req.params.id as string }, data: parse.data }));
    } catch (e) { fail(res, e, 'update specialty'); }
});

// Appointments are read-only here, and leave out clinical notes and prescriptions.
consultAdminRoutes.get('/appointments', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = appointmentsQuery.safeParse(req.query);
        if (!parse.success) return bad(res, parse);
        res.json(await listAppointments(parse.data));
    } catch (e) { fail(res, e, 'admin appointments'); }
});

consultAdminRoutes.get('/appointments/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await getAppointment(id.data));
    } catch (e) { fail(res, e, 'admin appointment'); }
});
