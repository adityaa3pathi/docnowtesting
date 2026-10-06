/**
 * Patient consultation routes, mounted at /api/consult. Every route resolves records through the
 * signed-in user, so another user's ids return 404. Cookie requests need a CSRF token (R20).
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { consultCsrfGuard } from '../../middleware/consultCsrf';
import { rateLimiter } from '../../middleware/rateLimiter';
import { createBooking, getBooking } from './consultations.booking';
import { verifyAndConfirm } from './consultations.payments';
import { DoctorError } from './doctors.status';

const bookingSchema = z.object({
    slotId: z.string().uuid('Invalid slot'),
    patientId: z.string().uuid('Invalid patient'),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid idempotency key'),
});

export const consultPatientRoutes = Router();
const patient = [authMiddleware, consultCsrfGuard] as const;

function fail(res: Response, e: unknown) {
    if (e instanceof DoctorError) return res.status(e.status).json({ error: e.message });
    console.error('[Consult] request failed:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
}

consultPatientRoutes.post('/bookings', ...patient, rateLimiter(5, 60, 'consult_book'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = bookingSchema.safeParse(req.body);
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        res.status(201).json(await createBooking({ userId: req.userId!, ...parse.data }));
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
