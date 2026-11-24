/**
 * Patient consultation routes, mounted at /api/consult. Every route resolves records through the
 * signed-in user, so another user's ids return 404. Cookie requests need a CSRF token.
 */
import { Router, Response } from 'express';
import multer from 'multer';
import { prisma } from '../../db';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { consultCsrfGuard } from '../../middleware/consultCsrf';
import { rateLimiter } from '../../middleware/rateLimiter';
import { createBooking, getBooking, listBookings } from './consultations.booking';
import { availableConsultPromos, checkConsultPromo } from './consultations.promo';
import { cancelConsultation, cancelPreview } from './consultations.cancellation';
import { verifyAndConfirm } from './consultations.payments';
import { sendConsultError } from './consultations.http';
import { CONSENT_REQUIRED, CONSENT_VERSION, guestInfo, guestJoin, patientJoin, signupConsentFor } from './consultations.room';
import { acceptFamilyLink, declineFamilyLink } from './consultations.family';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_BOOKING, removeAttachment, uploadAttachment } from './consultations.attachments';
import { reassignBooking, reassignOption, rescheduleBooking, rescheduleSlots, selfRescheduleBooking } from './consultations.reschedule';
import { kickConsultPushes } from './consultations.push';
import { addRecommendedTestsToCart, getPatientPrescription, prescriptionFromLink, prescriptionLinkToken } from './consultations.prescription';
import { renderPrescriptionPdf } from './consultations.prescriptionPdf';
import { RECORD_SHARE_VERSION, listDocuments, removeDocument, setRecordSharing, uploadDocument, type ShareMeta } from './consultations.records';
import { RANGE_DAYS, VITAL_KINDS, addPeriod, addReading, editPeriod, listPeriods, listReadings, periodEditSchema, periodSchema, readingSchema, removePeriod, removeReading } from './consultations.vitals';
import { DoctorError } from './doctors.status';

const bookingSchema = z.object({
    slotId: z.string().uuid('Invalid slot'),
    patientId: z.string().uuid('Invalid patient'),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid idempotency key'),
    isCaregiverJoined: z.boolean().optional(),
    attachedReportIds: z.array(z.string().uuid('Invalid report')).max(5, 'Attach at most 5 reports').optional(),
    attachmentIds: z.array(z.string().uuid('Invalid document')).max(MAX_ATTACHMENTS_PER_BOOKING, `Attach at most ${MAX_ATTACHMENTS_PER_BOOKING} documents`).optional(),
    useWallet: z.boolean().optional(),
    expectedWalletPaise: z.number().int().min(0).optional(),
    // Any code an admin can make (lab codes predate any format rule); control characters are refused.
    promoCode: z.string().trim().max(64, 'Invalid promo code').regex(/^[^\u0000-\u001f\u007f]*$/, 'Invalid promo code').optional(),
    expectedDiscountPaise: z.number().int().min(0).optional(),
    // The unticked "let the doctor see my health record" box, and the wording version shown.
    shareRecord: z.boolean().optional(),
    shareConsentVersion: z.string().trim().min(1).max(40).optional(),
    channel: z.enum(['app', 'web']).optional(),
});

const sharingSchema = z.object({
    share: z.boolean(),
    consentVersion: z.string().trim().min(1).max(40).optional(),
    channel: z.enum(['app', 'web']).optional(),
});
const shareMetaOf = (req: { ip?: string; get(name: string): string | undefined }, version: string | undefined, channel: 'app' | 'web' | undefined): ShareMeta => ({
    version: version ?? RECORD_SHARE_VERSION,
    channel: channel ?? 'web',
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
});

// NMC telemedicine consent: the join screen's checkbox. Without it nobody on the patient's side gets a room token.
const consentSchema = z.object({
    consent: z.literal(true),
    consentVersion: z.string().trim().min(1).max(40).optional(),
    channel: z.enum(['app', 'web']).optional(),
});
const consentOf = (req: { ip?: string; get(name: string): string | undefined }, body: z.infer<typeof consentSchema>) => ({
    version: body.consentVersion ?? CONSENT_VERSION,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
});

// One file per request, held in memory only long enough to check it and send it to private storage.
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });

export const consultPatientRoutes = Router();
const patient = [authMiddleware, consultCsrfGuard] as const;

const fail = (res: Response, e: unknown) => sendConsultError(res, e, '[Consult]');

consultPatientRoutes.post('/bookings', ...patient, rateLimiter(5, 60, 'consult_book'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = bookingSchema.safeParse(req.body);
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        const { shareConsentVersion, channel, ...input } = parse.data;
        res.status(201).json(await createBooking({ userId: req.userId!, ...input, shareMeta: shareMetaOf(req, shareConsentVersion, channel) }));
    } catch (e) { fail(res, e); }
});

// ── Outside medical records (photos / PDFs) for the doctor ──

const promoCheckSchema = z.object({
    code: z.string().trim().min(1, 'Enter a promo code').max(64, 'Invalid promo code').regex(/^[^\u0000-\u001f\u007f]+$/, 'Invalid promo code'),
    slotId: z.string().uuid('Invalid slot'),
});

// "Apply" on the review-and-pay page: what the code takes off this doctor's fee. Nothing is used up.
consultPatientRoutes.post('/promos/check', ...patient, rateLimiter(20, 60, 'consult_promo_check'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = promoCheckSchema.safeParse(req.body);
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        res.json(await checkConsultPromo(req.userId!, parse.data.code, parse.data.slotId));
    } catch (e) { fail(res, e); }
});

// Codes this patient can use with this doctor now.
consultPatientRoutes.get('/promos', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const doctorId = z.string().uuid().safeParse(req.query.doctorId);
        if (!doctorId.success) return res.status(400).json({ error: 'Invalid doctor' });
        res.json(await availableConsultPromos(req.userId!, doctorId.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/attachments', ...patient, rateLimiter(20, 600, 'consult_attachment'), (req: AuthRequest, res: Response) => {
    attachmentUpload.single('file')(req, res, async (err: unknown) => {
        try {
            if (err instanceof multer.MulterError) {
                return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 10 MB' : 'Upload one file at a time' });
            }
            if (err) throw err;
            const file = (req as AuthRequest & { file?: { buffer: Buffer; originalname: string } }).file;
            if (!file) return res.status(400).json({ error: 'Choose a photo or PDF to upload' });
            res.status(201).json(await uploadAttachment(req.userId!, file));
        } catch (e) { fail(res, e); }
    });
});

consultPatientRoutes.delete('/attachments/:id', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await removeAttachment(req.userId!, id.data));
    } catch (e) { fail(res, e); }
});

// ── Medical records vault (per person, outside any booking) ──

const uuidParam = (v: unknown) => {
    const id = z.string().uuid().safeParse(v);
    if (!id.success) throw new DoctorError(404, 'Not found');
    return id.data;
};

consultPatientRoutes.get('/records/:patientId/documents', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await listDocuments(req.userId!, uuidParam(req.params.patientId)));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/records/:patientId/documents', ...patient, rateLimiter(30, 600, 'consult_record_upload'), (req: AuthRequest, res: Response) => {
    attachmentUpload.single('file')(req, res, async (err: unknown) => {
        try {
            if (err instanceof multer.MulterError) {
                return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Files can be up to 10 MB' : 'Upload one file at a time' });
            }
            if (err) throw err;
            const file = (req as AuthRequest & { file?: { buffer: Buffer; originalname: string } }).file;
            if (!file) return res.status(400).json({ error: 'Choose a photo or PDF to upload' });
            res.status(201).json(await uploadDocument(req.userId!, uuidParam(req.params.patientId), file));
        } catch (e) { fail(res, e); }
    });
});

consultPatientRoutes.delete('/records/documents/:id', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await removeDocument(req.userId!, uuidParam(req.params.id)));
    } catch (e) { fail(res, e); }
});

// ── Vitals tracker (per person): BP and sugar readings, period logs ──

const vitalsQuery = z.object({
    kind: z.enum(VITAL_KINDS, { error: 'Choose BP or SUGAR' }),
    days: z.coerce.number().refine((d) => (RANGE_DAYS as readonly number[]).includes(d), 'Choose 30, 90 or 365 days').default(90),
});
const bad = (res: Response, e: z.ZodError) => res.status(400).json({ error: e.issues[0].message });

consultPatientRoutes.get('/vitals/:patientId/readings', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        const q = vitalsQuery.safeParse(req.query);
        if (!q.success) return bad(res, q.error);
        res.json(await listReadings(req.userId!, uuidParam(req.params.patientId), q.data.kind, q.data.days));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/vitals/:patientId/readings', ...patient, rateLimiter(60, 600, 'consult_vitals_write'), async (req: AuthRequest, res: Response) => {
    try {
        const body = readingSchema.safeParse(req.body);
        if (!body.success) return bad(res, body.error);
        res.status(201).json(await addReading(req.userId!, uuidParam(req.params.patientId), body.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.delete('/vitals/readings/:id', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await removeReading(req.userId!, uuidParam(req.params.id)));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.get('/vitals/:patientId/periods', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await listPeriods(req.userId!, uuidParam(req.params.patientId)));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/vitals/:patientId/periods', ...patient, rateLimiter(60, 600, 'consult_vitals_write'), async (req: AuthRequest, res: Response) => {
    try {
        const body = periodSchema.safeParse(req.body);
        if (!body.success) return bad(res, body.error);
        res.status(201).json(await addPeriod(req.userId!, uuidParam(req.params.patientId), body.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.patch('/vitals/periods/:id', ...patient, rateLimiter(60, 600, 'consult_vitals_write'), async (req: AuthRequest, res: Response) => {
    try {
        const body = periodEditSchema.safeParse(req.body);
        if (!body.success) return bad(res, body.error);
        res.json(await editPeriod(req.userId!, uuidParam(req.params.id), body.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.delete('/vitals/periods/:id', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await removePeriod(req.userId!, uuidParam(req.params.id)));
    } catch (e) { fail(res, e); }
});

// "Let the doctor see my health record" on one booking: switch on or off (booker or accepted family).
consultPatientRoutes.put('/bookings/:id/record-sharing', ...patient, rateLimiter(20, 60, 'consult_record_sharing'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = sharingSchema.safeParse(req.body);
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        const meta = shareMetaOf(req, parse.data.consentVersion, parse.data.channel);
        res.json(await setRecordSharing(req.userId!, uuidParam(req.params.id), parse.data.share, meta));
    } catch (e) { fail(res, e); }
});

// ── Family member: "booked for you" accept / not me ─────

consultPatientRoutes.post('/family/:patientId/accept', ...patient, rateLimiter(10, 60, 'consult_family_link'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.patientId);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await acceptFamilyLink(req.userId!, id.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/family/:patientId/decline', ...patient, rateLimiter(10, 60, 'consult_family_link'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.patientId);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await declineFamilyLink(req.userId!, id.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.get('/bookings', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        res.json(await listBookings(req.userId!));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.get('/bookings/:id/cancel-preview', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await cancelPreview(req.userId!, id.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.get('/bookings/:id', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const [booking, consentOnFile] = await Promise.all([getBooking(req.userId!, id.data), signupConsentFor(req.userId!, id.data)]);
        res.json({ ...booking, consentOnFile: consentOnFile !== null });
    } catch (e) { fail(res, e); }
});

const verifySchema = z.object({
    razorpay_order_id: z.string().max(64).optional(),
    razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/, 'Invalid payment id'),
    razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid signature'),
});

consultPatientRoutes.post('/bookings/:id/verify', ...patient, rateLimiter(10, 60, 'consult_verify'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const parse = verifySchema.safeParse(req.body);
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        res.json(await verifyAndConfirm(req.userId!, id.data, parse.data));
    } catch (e) { fail(res, e); }
});

const cancelSchema = z.object({ reason: z.string().max(200).optional() });

consultPatientRoutes.post('/bookings/:id/cancel', ...patient, rateLimiter(5, 60, 'consult_cancel'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const parse = cancelSchema.safeParse(req.body ?? {});
        if (!parse.success) return res.status(400).json({ error: 'Invalid reason' });
        res.json(await cancelConsultation(id.data, { kind: 'booker', userId: req.userId! }, parse.data.reason));
    } catch (e) { fail(res, e); }
});

// ── Patient changes the time (same doctor, within the booking's rules) ──

consultPatientRoutes.post('/bookings/:id/change-time', ...patient, rateLimiter(5, 60, 'consult_change_time'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const parse = z.object({ newSlotId: z.string().uuid({ message: 'Pick a time' }) }).safeParse(req.body ?? {});
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        res.json(await selfRescheduleBooking(req.userId!, id.data, parse.data.newSlotId));
        kickConsultPushes(id.data);
    } catch (e) { fail(res, e); }
});

// ── Doctor running late: free reschedule or the next free doctor (the refund is a cancel reason) ──

const rescheduleSchema = z.object({ newSlotId: z.string().uuid({ message: 'Pick a time' }) });
const reassignSchema = z.object({ slotId: z.string().uuid({ message: 'Pick a doctor' }) });

consultPatientRoutes.get('/bookings/:id/reschedule-slots', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await rescheduleSlots(req.userId!, id.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/bookings/:id/reschedule', ...patient, rateLimiter(5, 60, 'consult_reschedule'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const parse = rescheduleSchema.safeParse(req.body ?? {});
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        res.json(await rescheduleBooking(req.userId!, id.data, parse.data.newSlotId));
        kickConsultPushes(id.data);
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.get('/bookings/:id/reassign-option', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json({ option: await reassignOption(req.userId!, id.data) });
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/bookings/:id/reassign', ...patient, rateLimiter(5, 60, 'consult_reassign'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const parse = reassignSchema.safeParse(req.body ?? {});
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        res.json(await reassignBooking(req.userId!, id.data, parse.data.slotId));
        kickConsultPushes(id.data);
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/bookings/:id/join', ...patient, rateLimiter(20, 60, 'consult_join'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const consent = consentSchema.safeParse(req.body ?? {});
        const given = consent.success
            ? { ...consentOf(req, consent.data), channel: consent.data.channel ?? 'app', userId: req.userId! }
            : await signupConsentFor(req.userId!, id.data);
        if (!given) return res.status(400).json({ error: CONSENT_REQUIRED, code: 'CONSENT_REQUIRED' });
        res.json(await patientJoin(req.userId!, id.data, { consent: { ...given, ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null } }));
        kickConsultPushes(id.data);
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.get('/bookings/:id/prescription', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const { consultation, ...p } = await getPatientPrescription(req.userId!, id.data);
        res.json(p);
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.get('/bookings/:id/prescription.pdf', ...patient, async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        const pdf = await renderPrescriptionPdf(await getPatientPrescription(req.userId!, id.data));
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="docnow-prescription-${id.data.slice(0, 8)}.pdf"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(pdf);
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.get('/bookings/:id/prescription/link', ...patient, rateLimiter(20, 60, 'consult_rx_link'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await prescriptionLinkToken(req.userId!, id.data));
    } catch (e) { fail(res, e); }
});

consultPatientRoutes.post('/bookings/:id/recommended-tests/cart', ...patient, rateLimiter(10, 60, 'consult_rx_cart'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await addRecommendedTestsToCart(req.userId!, id.data));
    } catch (e) { fail(res, e); }
});

// ── Public: zero-login family room and signed prescription links ──
// No sign-in: the guest token (a random UUID, sent only to the family member's phone) or the
// signed link is the credential. Rate-limited per IP; nothing clinical is returned before the call.

export const consultGuestRoutes = Router();

consultGuestRoutes.get('/guest/:token', rateLimiter(60, 60, 'consult_guest'), async (req, res: Response) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await guestInfo(String(req.params.token)));
    } catch (e) { fail(res, e); }
});

consultGuestRoutes.post('/guest/:token/join', rateLimiter(20, 60, 'consult_guest_join'), async (req, res: Response) => {
    try {
        const consent = consentSchema.safeParse(req.body ?? {});
        if (!consent.success) return res.status(400).json({ error: CONSENT_REQUIRED, code: 'CONSENT_REQUIRED' });
        const out = await guestJoin(String(req.params.token), { consent: { ...consentOf(req, consent.data), channel: 'guest-link' } });
        res.json(out);
        // The doctor hears "your patient is waiting" straight away.
        void prisma.consultation.findUnique({ where: { guestToken: String(req.params.token) }, select: { id: true } })
            .then((c) => c && kickConsultPushes(c.id)).catch(() => {});
    } catch (e) { fail(res, e); }
});

consultGuestRoutes.get('/prescriptions/public/:token', rateLimiter(30, 60, 'consult_rx_public'), async (req, res: Response) => {
    try {
        const p = await prescriptionFromLink(String(req.params.token));
        const pdf = await renderPrescriptionPdf(p);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="docnow-prescription-${p.consultationId.slice(0, 8)}.pdf"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(pdf);
    } catch (e) { fail(res, e); }
});
