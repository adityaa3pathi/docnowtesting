/**
 * Doctor Routes
 *
 * Public: specialties and approved doctors.
 * Signed-in user: register as a doctor, see own application.
 * Doctor (approved): own profile, hours, leave, slot blocking. New hours and profile text wait for a
 * super admin (doctors.changes.ts); gender, photo and leave apply at once.
 * Super admin: create doctors, edit, approve, reject, suspend, specialties, review doctor changes.
 */
import { Request, Router, Response } from 'express';
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
import { adminSaveDoctorPhoto, doctorPhotoLink, MAX_PHOTO_BYTES, saveDoctorPhoto } from './doctors.photo';
import multer from 'multer';
import { directoryQuery, listDirectory, publicDoctorSelect } from './doctors.directory';
import { doctorListQuery, listDoctorConsultations } from './doctors.consultations';
import { policyRoutes } from './consultations.policy.routes';
import { reviewRoutes } from './consultations.review.routes';
import { instantAdminRoutes } from './consultations.instantAdmin.routes';
import { doctorJoin, endConsultation } from './consultations.room';
import { chatReadSchema, chatSendSchema, doctorChat } from './consultations.chat';
import { kickConsultPushes } from './consultations.push';
import { getDoctorRecord, issuePrescription, noteSchema, prescriptionSchema, reissuePrescription, reissueSchema, saveNotes } from './consultations.prescription';
import { renderPrescriptionPdf } from './consultations.prescriptionPdf';
import { getSharedRecord, openSharedFile } from './consultations.records';
import { accountPeople, getPatientRecord, openPatientFile } from './consultations.adminRecords';
import { getDoctorPatient, listDoctorPatients, patientListQuery } from './doctors.patients';
import { appointmentsQuery, getAppointment, listAppointments } from './consultations.appointments';
import {
    addLeave, adminCreateDoctor, adminUpdateDoctor, registerDoctor, removeLeave, resubmitDoctor, reviewDoctor, setSlotBlocked,
} from './doctors.service';
import { listChanges, myChanges, reviewChange, submitAvailabilityChange, submitProfileChange, withdrawChange } from './doctors.changes';
import { adminListQuery, adminListReviews, doctorOwnReviews, doctorRatings, publicRating, moderateReview, MODERATIONS, publicAppReviews, publicDoctorReviews, REVIEW_KINDS } from './consultations.reviews';
import { acceptInstant, declineInstant, doctorCheckIn, doctorInstantState, goOffline, goOnline, instantAvailability } from './consultations.instant';

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


// ── Public ──────────────────────────────────────────────

export const consultPublicRoutes = Router();

consultPublicRoutes.get('/specialties', async (_req, res) => {
    try {
        res.json(await prisma.specialty.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }));
    } catch (e) { fail(res, e, 'list specialties'); }
});

// Filters, name search, "Online now" and sort in the query; `page` switches to a paged reply (doctors.directory.ts).
// Only the paged list (each filter, search or page change) is limited, generously, since visitors can share an IP.
// The plain array is one call per page load (homepage, mobile app) and stays unlimited as before.
const doctorSearchLimit = rateLimiter(300, 60, 'consult_doctor_search');
consultPublicRoutes.get('/doctors', (req, res, next) => (req.query.page === undefined ? next() : doctorSearchLimit(req, res, next)), async (req, res) => {
    try {
        const query = directoryQuery.safeParse(req.query);
        if (!query.success) return bad(res, query);
        res.json(await listDirectory(query.data));
    } catch (e) { fail(res, e, 'list doctors'); }
});

consultPublicRoutes.get('/doctors/:id', async (req, res) => {
    try {
        const doctor = await prisma.doctorProfile.findFirst({
            where: { id: req.params.id, status: 'APPROVED' },
            select: { ...publicDoctorSelect, registrationNumber: true, registrationCouncil: true },
        });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
        res.json({ ...doctor, rating: publicRating((await doctorRatings([doctor.id])).get(doctor.id)) });
    } catch (e) { fail(res, e, 'get doctor'); }
});

const reviewPage = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) });

// Visible reviews only, newest first, never naming the author.
consultPublicRoutes.get('/doctors/:id/reviews', rateLimiter(120, 60, 'consult_reviews_read'), async (req, res) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Doctor not found' });
        const q = reviewPage.safeParse(req.query);
        if (!q.success) return bad(res, q);
        res.json(await publicDoctorReviews(id.data, q.data.page));
    } catch (e) { fail(res, e, 'doctor reviews'); }
});

consultPublicRoutes.get('/app-reviews', rateLimiter(120, 60, 'consult_reviews_read'), async (req, res) => {
    try {
        const q = reviewPage.safeParse(req.query);
        if (!q.success) return bad(res, q);
        res.json(await publicAppReviews(q.data.page));
    } catch (e) { fail(res, e, 'app reviews'); }
});

// Stable photo link: redirects to a fresh signed link; browsers keep it for an hour.
consultPublicRoutes.get('/doctors/:id/photo', async (req, res) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        const link = id.success ? await doctorPhotoLink(id.data) : null;
        if (!link) return res.status(404).json({ error: 'No photo' });
        res.set('Cache-Control', 'public, max-age=3600');
        // The site (docnow.in) shows these from the API's origin (api.docnow.in); helmet's default
        // same-origin policy would block every doctor photo. They are public, so any origin may embed them.
        res.set('Cross-Origin-Resource-Policy', 'cross-origin');
        res.redirect(302, link);
    } catch (e) { fail(res, e, 'doctor photo'); }
});

// "Consult a Doc now": how many are online, the fee range, and the next GP time when nobody is.
consultPublicRoutes.get('/instant/availability', rateLimiter(60, 60, 'consult_instant_availability'), async (_req, res) => {
    try {
        res.json(await instantAvailability());
    } catch (e) { fail(res, e, 'instant availability'); }
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

doctorRoutes.post('/register', authMiddleware, consultCsrfGuard, rateLimiter(5, 3600, 'doctor_register'), async (req: AuthRequest, res: Response) => {
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
        res.json({ ...doctor, changeRequests: await myChanges(doctor.id) });
    } catch (e) { fail(res, e, 'get me'); }
});

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } });
type PhotoRequest = AuthRequest & { file?: { buffer: Buffer } };
const publicBase = (req: Request) => `${req.protocol}://${req.get('host')}`;

/** Runs the one-photo multipart parser, answering 400/413 itself for a bad upload. */
function withPhoto(handler: (req: PhotoRequest, res: Response) => Promise<unknown>, what: string) {
    return (req: AuthRequest, res: Response) => {
        photoUpload.single('photo')(req, res, async (err: unknown) => {
            try {
                if (err instanceof multer.MulterError) {
                    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photos can be up to 3 MB' : 'Upload one photo' });
                }
                if (err) throw err;
                await handler(req as PhotoRequest, res);
            } catch (e) { fail(res, e, what); }
        });
    };
}

// Any profile owner, approved or not: applicants need a photo before they can be approved.
doctorRoutes.post('/me/photo', authMiddleware, consultCsrfGuard, rateLimiter(10, 3600, 'doctor_photo'), withPhoto(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload' });
    res.json(await saveDoctorPhoto(req.userId!, req.file.buffer, publicBase(req)));
}, 'upload photo'));

const mine = [authMiddleware, requireDoctor] as const;

async function myDoctorId(req: AuthRequest) {
    const d = await prisma.doctorProfile.findUnique({ where: { userId: req.userId }, select: { id: true, status: true } });
    if (!d || d.status !== 'APPROVED') throw new DoctorError(403, 'Doctor profile is not approved');
    return d.id;
}

/**
 * Gender applies at once (patients filter by it; it is not a claim to check). Bio, languages and
 * experience are shown to patients, so they wait for a super admin: `request` is the pending change,
 * or null when nothing differs from the live profile.
 */
doctorRoutes.patch('/me', ...mine, consultCsrfGuard, async (req: AuthRequest, res: Response) => {
    try {
        const parse = doctorSelfUpdateSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = await myDoctorId(req);
        const { gender, ...reviewed } = parse.data;
        // The reviewed part first: if it fails, nothing is saved and the error is the whole answer.
        const { request } = Object.keys(reviewed).length ? await submitProfileChange(id, reviewed) : { request: undefined };
        if (gender) await prisma.doctorProfile.update({ where: { id }, data: { gender } });
        const doctor = await prisma.doctorProfile.findUniqueOrThrow({ where: { id }, include: { specialty: true, availability: true } });
        res.status(request ? 202 : 200).json({ doctor, request: request ?? null });
    } catch (e) { fail(res, e, 'update me'); }
});

/** New hours wait for a super admin; the live hours and slots keep running until then. */
doctorRoutes.put('/me/availability', ...mine, consultCsrfGuard, rateLimiter(30, 3600, 'doctor_hours_change'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = availabilitySchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = await myDoctorId(req);
        const { request } = await submitAvailabilityChange(id, parse.data);
        res.status(request ? 202 : 200).json({ request });
    } catch (e) { fail(res, e, 'set availability'); }
});

doctorRoutes.delete('/me/changes/:id', ...mine, consultCsrfGuard, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        await withdrawChange(await myDoctorId(req), id.data);
        res.json({ success: true });
    } catch (e) { fail(res, e, 'withdraw change'); }
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

// Their own visible reviews, read-only: no author, no consultation (P11).
doctorRoutes.get('/me/reviews', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const q = reviewPage.safeParse(req.query);
        if (!q.success) return bad(res, q);
        res.json(await doctorOwnReviews(await myDoctorId(req), q.data.page));
    } catch (e) { fail(res, e, 'my reviews'); }
});

// "Patients": people this doctor has seen or is booked to see, and their own visits with each.
doctorRoutes.get('/me/patients', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const parse = patientListQuery.safeParse(req.query);
        if (!parse.success) return bad(res, parse);
        res.json(await listDoctorPatients(await myDoctorId(req), parse.data));
    } catch (e) { fail(res, e, 'list my patients'); }
});

doctorRoutes.get('/me/patients/:patientId', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.patientId);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await getDoctorPatient(await myDoctorId(req), id.data));
    } catch (e) { fail(res, e, 'get my patient'); }
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

// The patient's whole DocNow record, when they shared it for this booking (until 7 days after). Logged.
doctorRoutes.get('/me/consultations/:id/record', ...mine, rateLimiter(60, 60, 'doctor_record'), async (req: AuthRequest, res: Response) => {
    try {
        res.json(await getSharedRecord(await myDoctorId(req), consultId(req), { ipAddress: req.ip ?? null }));
    } catch (e) { fail(res, e, 'get shared record'); }
});

const SHARED_KINDS = { documents: 'document', attachments: 'attachment', reports: 'report' } as const;

// One file or report from the shared record: a short link, and a log row per open.
doctorRoutes.get('/me/consultations/:id/record/:kind/:targetId', ...mine, rateLimiter(60, 60, 'doctor_record_open'), async (req: AuthRequest, res: Response) => {
    try {
        const kind = Object.prototype.hasOwnProperty.call(SHARED_KINDS, String(req.params.kind)) ? SHARED_KINDS[req.params.kind as keyof typeof SHARED_KINDS] : undefined;
        const target = z.string().uuid().safeParse(req.params.targetId);
        if (!kind || !target.success) return res.status(404).json({ error: 'Not found' });
        res.json(await openSharedFile(await myDoctorId(req), consultId(req), kind, target.data, { ipAddress: req.ip ?? null }));
    } catch (e) { fail(res, e, 'open shared record'); }
});

doctorRoutes.post('/me/consultations/:id/join', ...mineWrite, rateLimiter(20, 60, 'doctor_join'), async (req: AuthRequest, res: Response) => {
    try {
        const id = consultId(req);
        res.json(await doctorJoin(await myDoctorId(req), req.userId!, id));
        kickConsultPushes(id);
    } catch (e) { fail(res, e, 'join'); }
});

// In-call chat: polled every few seconds while the call is open, read-only afterwards.
doctorRoutes.get('/me/consultations/:id/chat', ...mine, rateLimiter(90, 60, 'doctor_chat_read'), async (req: AuthRequest, res: Response) => {
    try {
        const q = chatReadSchema.safeParse(req.query);
        if (!q.success) return bad(res, q);
        res.setHeader('Cache-Control', 'no-store');
        res.json(await doctorChat.read(await myDoctorId(req), consultId(req), q.data.after));
    } catch (e) { fail(res, e, 'read chat'); }
});

doctorRoutes.post('/me/consultations/:id/chat', ...mineWrite, rateLimiter(30, 60, 'doctor_chat_send'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = chatSendSchema.safeParse(req.body ?? {});
        if (!parse.success) return bad(res, parse);
        res.json(await doctorChat.send(await myDoctorId(req), consultId(req), parse.data));
    } catch (e) { fail(res, e, 'send chat'); }
});

// ── Instant consults (P10): online switch, check-ins, rings ──

const onlineSchema = z.object({ online: z.boolean() });

doctorRoutes.get('/me/instant', ...mine, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await doctorInstantState(await myDoctorId(req)));
    } catch (e) { fail(res, e, 'instant state'); }
});

doctorRoutes.put('/me/instant/online', ...mineWrite, rateLimiter(30, 60, 'doctor_instant_online'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = onlineSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = await myDoctorId(req);
        res.json(parse.data.online ? await goOnline(id) : await goOffline(id));
    } catch (e) { fail(res, e, 'instant online'); }
});

// The open panel checks in every few seconds while online: it keeps the doctor online and is how a ring reaches the screen.
doctorRoutes.post('/me/instant/check-in', ...mineWrite, rateLimiter(60, 60, 'doctor_instant_check_in'), async (req: AuthRequest, res: Response) => {
    try {
        res.json(await doctorCheckIn(await myDoctorId(req)));
    } catch (e) { fail(res, e, 'instant check-in'); }
});

doctorRoutes.post('/me/instant/:id/accept', ...mineWrite, rateLimiter(20, 60, 'doctor_instant_answer'), async (req: AuthRequest, res: Response) => {
    try {
        res.json(await acceptInstant(await myDoctorId(req), consultId(req)));
    } catch (e) { fail(res, e, 'instant accept'); }
});

doctorRoutes.post('/me/instant/:id/decline', ...mineWrite, rateLimiter(20, 60, 'doctor_instant_answer'), async (req: AuthRequest, res: Response) => {
    try {
        res.json(await declineInstant(await myDoctorId(req), consultId(req)));
    } catch (e) { fail(res, e, 'instant decline'); }
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
        const id = consultId(req);
        res.status(201).json(await issuePrescription(await myDoctorId(req), id, parse.data));
        kickConsultPushes(id);
    } catch (e) { fail(res, e, 'issue prescription'); }
});

doctorRoutes.post('/me/consultations/:id/prescription/reissue', ...mineWrite, rateLimiter(10, 60, 'doctor_rx'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = reissueSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = consultId(req);
        res.status(201).json(await reissuePrescription(await myDoctorId(req), id, parse.data));
        kickConsultPushes(id); // the patient must hear about a correction now, not at the next sweep
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
consultAdminRoutes.use('/instant', instantAdminRoutes);
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
            include: {
                specialty: true, availability: true, user: { select: { mobile: true, email: true } },
                changeRequests: { where: { status: 'PENDING' }, select: { id: true, kind: true, createdAt: true } },
            },
        });
        if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
        const { changeRequests, ...rest } = doctor;
        res.json({ ...rest, pendingChanges: changeRequests });
    } catch (e) { fail(res, e, 'admin get'); }
});

/** Multipart: the profile as JSON in `data`, plus the required `photo` file. */
function createFields(body: unknown): unknown {
    const raw = (body as { data?: unknown } | undefined)?.data;
    if (typeof raw !== 'string') return body;
    try { return JSON.parse(raw); } catch { return null; }
}

consultAdminRoutes.post('/doctors', ...admin, consultCsrfGuard, withPhoto(async (req, res) => {
    const parse = adminCreateDoctorSchema.safeParse(createFields(req.body));
    if (!parse.success) return bad(res, parse);
    if (!req.file) return res.status(400).json({ error: "Add the doctor's photo" });
    const doctor = await adminCreateDoctor(req.adminId!, parse.data, req.file.buffer, publicBase(req));
    await audit(req, 'DOCTOR_CREATE', doctor!.id);
    res.status(201).json(doctor);
}, 'admin create'));

consultAdminRoutes.post('/doctors/:id/photo', ...admin, consultCsrfGuard, rateLimiter(30, 3600, 'admin_doctor_photo'), withPhoto(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: 'Doctor not found' });
    if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload' });
    const saved = await adminSaveDoctorPhoto(id.data, req.file.buffer, publicBase(req));
    await audit(req, 'DOCTOR_PHOTO_UPDATE', id.data);
    res.json(saved);
}, 'admin upload photo'));

consultAdminRoutes.patch('/doctors/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = adminUpdateDoctorSchema.safeParse(req.body);
        if (!parse.success) return bad(res, parse);
        const id = req.params.id as string;
        const updated = await adminUpdateDoctor(id, parse.data);
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

// ── Super admin: doctor change requests ─────────────────

const changeStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING');

consultAdminRoutes.get('/doctor-changes', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const status = changeStatus.safeParse(req.query.status ?? undefined);
        if (!status.success) return res.status(400).json({ error: 'Unknown status' });
        res.json(await listChanges(status.data));
    } catch (e) { fail(res, e, 'list doctor changes'); }
});

for (const [path, decision] of [['approve', 'APPROVED'], ['reject', 'REJECTED']] as const) {
    consultAdminRoutes.post(`/doctor-changes/:id/${path}`, ...admin, consultCsrfGuard, rateLimiter(60, 60, 'doctor_change_review'), async (req: AuthRequest, res: Response) => {
        try {
            const id = z.string().uuid().safeParse(req.params.id);
            if (!id.success) return res.status(404).json({ error: 'Change request not found' });
            let reason: string | undefined;
            if (decision === 'REJECTED') {
                const parse = reviewReasonSchema.safeParse(req.body);
                if (!parse.success) return bad(res, parse);
                reason = parse.data.reason;
            }
            const reviewer = { adminId: req.adminId!, adminName: req.adminName || 'Admin', ip: getClientIP(req) };
            res.json(await reviewChange(reviewer, id.data, decision, reason));
        } catch (e) { fail(res, e, `doctor change ${path}`); }
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

// ── Super admin: a person's whole health record (every view and file open is audit-logged) ──

const actorOf = (req: AuthRequest) => ({ adminId: req.adminId!, adminName: req.adminName || 'Admin', ipAddress: getClientIP(req) });
const ADMIN_FILE_KINDS = { documents: 'document', attachments: 'attachment', reports: 'report' } as const;

consultAdminRoutes.get('/users/:id/people', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await accountPeople(id.data));
    } catch (e) { fail(res, e, 'admin account people'); }
});

consultAdminRoutes.get('/patients/:id/record', ...admin, rateLimiter(60, 60, 'admin_patient_record'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await getPatientRecord(id.data, actorOf(req)));
    } catch (e) { fail(res, e, 'admin patient record'); }
});

consultAdminRoutes.get('/patients/:id/record/:kind/:targetId', ...admin, rateLimiter(60, 60, 'admin_patient_file'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        const target = z.string().uuid().safeParse(req.params.targetId);
        const kind = Object.prototype.hasOwnProperty.call(ADMIN_FILE_KINDS, String(req.params.kind)) ? ADMIN_FILE_KINDS[req.params.kind as keyof typeof ADMIN_FILE_KINDS] : undefined;
        if (!id.success || !target.success || !kind) return res.status(404).json({ error: 'Not found' });
        res.json(await openPatientFile(id.data, kind, target.data, actorOf(req)));
    } catch (e) { fail(res, e, 'admin patient file'); }
});

consultAdminRoutes.get('/appointments/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await getAppointment(id.data));
    } catch (e) { fail(res, e, 'admin appointment'); }
});

// Review moderation (P11): hide, unhide, delete (soft), redact, reply. Each step is audit-logged.
consultAdminRoutes.get('/reviews', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const q = adminListQuery.safeParse(req.query);
        if (!q.success) return bad(res, q);
        res.json(await adminListReviews(q.data));
    } catch (e) { fail(res, e, 'list reviews'); }
});

consultAdminRoutes.post('/reviews/:kind/:id/:action', ...admin, consultCsrfGuard, rateLimiter(60, 60, 'review_moderation'), async (req: AuthRequest, res: Response) => {
    try {
        const kind = z.enum(REVIEW_KINDS).safeParse(req.params.kind);
        const action = z.enum(MODERATIONS).safeParse(req.params.action);
        const id = z.string().uuid().safeParse(req.params.id);
        if (!kind.success || !action.success || !id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await moderateReview(kind.data, id.data, action.data, req.body, {
            adminId: req.adminId!, adminName: req.adminName || 'Admin', ipAddress: getClientIP(req),
        }));
    } catch (e) { fail(res, e, 'moderate review'); }
});
