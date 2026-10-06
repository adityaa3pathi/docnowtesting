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
