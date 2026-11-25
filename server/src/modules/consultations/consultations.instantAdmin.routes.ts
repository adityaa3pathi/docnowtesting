/** Super admin "Online now" (P10c): read-only. Mounted under /api/admin/consult/instant. */
import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { requireSuperAdmin } from '../../middleware/adminAuth';
import { rateLimiter } from '../../middleware/rateLimiter';
import { getClientIP } from '../../utils/adminHelpers';
import { instantOutcomes, instantRequestDetail, liveRequests, onlineNow, OUTCOME_WINDOWS, type OutcomeWindow } from './consultations.instantAdmin';
import { istDayOf, presenceHours, PresenceRangeError } from './consultations.presenceHours';
import { sendConsultError } from './consultations.http';

export const instantAdminRoutes = Router();
// The page polls the live view every 5 s; 120/min leaves room for two tabs.
const admin = [authMiddleware, requireSuperAdmin, rateLimiter(120, 60, 'consult_admin_instant')] as const;
const fail = (res: Response, e: unknown) => sendConsultError(res, e, '[ConsultInstantAdmin]');

instantAdminRoutes.get('/live', ...admin, async (_req: AuthRequest, res: Response) => {
    try {
        const now = new Date();
        const [online, requests] = await Promise.all([onlineNow({ now }), liveRequests({ now })]);
        res.json({ ...online, requests: requests.items, waitingTotal: requests.total });
    } catch (e) { fail(res, e); }
});

instantAdminRoutes.get('/requests/:id', ...admin, async (req: AuthRequest, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: 'Not found' });
    try {
        res.json(await instantRequestDetail({ adminId: req.adminId!, adminName: req.adminName || 'Admin', ipAddress: getClientIP(req) }, id.data));
    } catch (e) { fail(res, e); }
});

const windowSchema = z.enum(Object.keys(OUTCOME_WINDOWS) as [OutcomeWindow, ...OutcomeWindow[]]).default('24h');

instantAdminRoutes.get('/outcomes', ...admin, async (req: AuthRequest, res: Response) => {
    const w = windowSchema.safeParse(req.query.window);
    if (!w.success) return res.status(400).json({ error: 'window must be 24h or 7d' });
    try { res.json(await instantOutcomes(w.data)); } catch (e) { fail(res, e); }
});

const presenceSchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    doctorId: z.string().uuid().optional(),
});

instantAdminRoutes.get('/presence', ...admin, async (req: AuthRequest, res: Response) => {
    const q = presenceSchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid filters' });
    const now = new Date();
    const toDay = q.data.to ?? istDayOf(now);
    const fromDay = q.data.from ?? istDayOf(new Date(now.getTime() - 6 * 86_400_000));
    try {
        const doctors = await presenceHours(prisma, { fromDay, toDay, doctorIds: q.data.doctorId ? [q.data.doctorId] : undefined, now });
        res.json({ from: fromDay, to: toDay, doctors });
    } catch (e) {
        if (e instanceof PresenceRangeError) return res.status(400).json({ error: e.message });
        fail(res, e);
    }
});
