/**
 * Patient consultation routes, mounted at /api/consult. Every route resolves records through the
 * signed-in user, so another user's ids return 404. Cookie requests need a CSRF token.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { consultCsrfGuard } from '../../middleware/consultCsrf';
import { rateLimiter } from '../../middleware/rateLimiter';
import { createBooking, getBooking, listBookings } from './consultations.booking';
import { cancelConsultation, cancelPreview } from './consultations.cancellation';
import { verifyAndConfirm } from './consultations.payments';
import { sendConsultError } from './consultations.http';
import { patientJoin } from './consultations.room';
import { reassignBooking, reassignOption, rescheduleBooking, rescheduleSlots } from './consultations.reschedule';
import { kickConsultPushes } from './consultations.push';
import { addRecommendedTestsToCart, getPatientPrescription } from './consultations.prescription';
import { renderPrescriptionPdf } from './consultations.prescriptionPdf';

const bookingSchema = z.object({
    slotId: z.string().uuid('Invalid slot'),
    patientId: z.string().uuid('Invalid patient'),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid idempotency key'),
});

export const consultPatientRoutes = Router();
const patient = [authMiddleware, consultCsrfGuard] as const;

const fail = (res: Response, e: unknown) => sendConsultError(res, e, '[Consult]');

consultPatientRoutes.post('/bookings', ...patient, rateLimiter(5, 60, 'consult_book'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = bookingSchema.safeParse(req.body);
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        res.status(201).json(await createBooking({ userId: req.userId!, ...parse.data }));
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
        res.json(await getBooking(req.userId!, id.data));
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
        res.json(await patientJoin(req.userId!, id.data));
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

consultPatientRoutes.post('/bookings/:id/recommended-tests/cart', ...patient, rateLimiter(10, 60, 'consult_rx_cart'), async (req: AuthRequest, res: Response) => {
    try {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        res.json(await addRecommendedTestsToCart(req.userId!, id.data));
    } catch (e) { fail(res, e); }
});
