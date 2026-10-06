/**
 * Admin routes for consultation rules. Mounted at /api/admin/consult/policy.
 * Super admin only; cookie requests need a CSRF token even with the mobile header.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { requireSuperAdmin } from '../../middleware/adminAuth';
import { consultCsrfGuard } from '../../middleware/consultCsrf';
import { rateLimiter } from '../../middleware/rateLimiter';
import { getClientIP } from '../../utils/adminHelpers';
import { getActivePolicy, listPolicyVersions, updatePolicy } from './consultations.policy.service';
import { sendConsultError } from './consultations.http';

const updateSchema = z.object({
    reason: z.string().trim().min(3, 'A reason is required').max(300),
    rules: z.object({
        refundTiers: z.array(z.object({ minHoursBefore: z.number(), percent: z.number() })).max(10),
        doctorNoShowWaitMinutes: z.number(),
        patientNoShowWaitMinutes: z.number(),
        doctorNoShowOutcome: z.literal('FULL_REFUND'),
        platformFeeBps: z.number(),
        holdMinutes: z.number(),
        minLeadMinutes: z.number(),
        uploadLimitMb: z.number(),
    }),
});

export const policyRoutes = Router();
const admin = [authMiddleware, requireSuperAdmin, consultCsrfGuard] as const;

const fail = (res: Response, e: unknown) => sendConsultError(res, e, '[ConsultPolicy]');

policyRoutes.get('/', ...admin, async (_req: AuthRequest, res: Response) => {
    try {
        res.json({ active: await getActivePolicy(), versions: await listPolicyVersions() });
    } catch (e) { fail(res, e); }
});

policyRoutes.put('/', ...admin, rateLimiter(10, 3600, 'consult_policy_edit'), async (req: AuthRequest, res: Response) => {
    try {
        const parse = updateSchema.safeParse(req.body);
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        const created = await updatePolicy({
            rules: parse.data.rules,
            reason: parse.data.reason,
            adminId: req.adminId!,
            adminName: req.adminName || 'Admin',
            ip: getClientIP(req),
        });
        res.json(created);
    } catch (e) { fail(res, e); }
});
