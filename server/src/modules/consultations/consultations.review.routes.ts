/**
 * Staff routes for consultation money: cancel on a patient's behalf and resolve the queue of
 * flagged payments and failed refunds. Super admin only, CSRF-guarded like the patient routes
 * (R20), reason required, actor and IP in the admin audit log. Money moves only through the
 * same refund lock and confirm step as everything else.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { requireSuperAdmin } from '../../middleware/adminAuth';
import { consultCsrfGuard } from '../../middleware/consultCsrf';
import { rateLimiter } from '../../middleware/rateLimiter';
import { getClientIP } from '../../utils/adminHelpers';
import { cancelConsultation } from './consultations.cancellation';
import { confirmPayment } from './consultations.payments';
import { createRefundRecord, MAX_REFUND_ATTEMPTS, runRefund } from './consultations.refunds';
import { DoctorError } from './doctors.status';

export const reviewRoutes = Router();
const admin = [authMiddleware, requireSuperAdmin, consultCsrfGuard, rateLimiter(30, 60, 'consult_admin')] as const;
const reasonSchema = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(200) });
const resolveSchema = reasonSchema.extend({ action: z.enum(['confirm', 'refund']) });
const idParam = z.string().uuid();

function fail(res: Response, e: unknown) {
    if (e instanceof DoctorError) return res.status(e.status).json({ error: e.message });
    console.error('[ConsultReview] request failed:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
}

async function audit(req: AuthRequest, action: string, entity: string, targetId: string, newValue: object) {
    await prisma.adminAuditLog.create({
        data: {
            adminId: req.adminId!,
            adminName: req.adminName || 'Admin',
            action,
            entity,
            targetId,
            newValue: newValue as any,
            ipAddress: getClientIP(req),
        },
    });
}

reviewRoutes.get('/review', ...admin, async (_req: AuthRequest, res: Response) => {
    try {
        const [flagged, refunds] = await Promise.all([
            prisma.consultation.findMany({
                where: { reviewReason: { not: null }, status: { in: ['PENDING_PAYMENT', 'EXPIRED'] } },
                select: { id: true, status: true, reviewReason: true, feePaise: true, updatedAt: true },
                orderBy: { updatedAt: 'asc' },
                take: 100,
            }),
            prisma.consultationRefund.findMany({
                where: { OR: [{ status: 'FAILED' }, { status: 'PENDING', attempts: { gte: MAX_REFUND_ATTEMPTS } }] },
                select: { id: true, consultationId: true, reason: true, amountPaise: true, status: true, attempts: true, lastError: true, failureConfirmed: true },
                orderBy: { updatedAt: 'asc' },
                take: 100,
            }),
        ]);
        res.json({ flaggedPayments: flagged, refundsNeedingStaff: refunds });
    } catch (e) { fail(res, e); }
});

reviewRoutes.post('/consultations/:id/cancel', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const id = idParam.safeParse(req.params.id);
        const parse = reasonSchema.safeParse(req.body);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        const result = await cancelConsultation(id.data, { kind: 'admin', adminId: req.adminId! }, parse.data.reason);
        await audit(req, 'CONSULT_ADMIN_CANCEL', 'Consultation', id.data, { reason: parse.data.reason, result });
        res.json(result);
    } catch (e) { fail(res, e); }
});

reviewRoutes.post('/review/refunds/:id/retry', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const id = idParam.safeParse(req.params.id);
        const parse = reasonSchema.safeParse(req.body);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
        // Attempts restart at 1 so the runner first looks for a refund an earlier attempt may have made.
        const reopened = await prisma.consultationRefund.updateMany({
            where: { id: id.data, OR: [{ status: 'FAILED' }, { status: 'PENDING', attempts: { gte: MAX_REFUND_ATTEMPTS } }] },
            data: { status: 'PENDING', attempts: 1, failureConfirmed: false, lastError: null },
        });
        if (reopened.count !== 1) throw new DoctorError(409, 'This refund does not need staff action');
        const outcome = await runRefund(id.data);
        await audit(req, 'CONSULT_REFUND_RETRY', 'ConsultationRefund', id.data, { reason: parse.data.reason, outcome });
        res.json({ outcome });
    } catch (e) { fail(res, e); }
});

reviewRoutes.post('/review/consultations/:id/resolve', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const id = idParam.safeParse(req.params.id);
        const parse = resolveSchema.safeParse(req.body);
        if (!id.success) return res.status(404).json({ error: 'Not found' });
        if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });

        const c = await prisma.consultation.findFirst({ where: { id: id.data, reviewReason: { not: null } }, include: { payments: true } });
        if (!c) throw new DoctorError(404, 'Not found');
        const payment = c.payments.find((p) => p.status === 'CAPTURED' && p.razorpayPaymentId);
        if (!payment) throw new DoctorError(409, 'No captured payment to resolve');

        let outcome: string;
        if (parse.data.action === 'confirm') {
            outcome = await confirmPayment(
                { paymentId: payment.razorpayPaymentId!, orderId: payment.razorpayOrderId, amountPaise: payment.amountPaise, currency: 'INR' },
                { acceptAmount: true },
            );
        } else {
            const record = await prisma.$transaction(async (tx) => {
                const created = await createRefundRecord(tx, { consultationId: c.id, paymentId: payment.id, reason: 'ADMIN' });
                await tx.consultation.update({ where: { id: c.id }, data: { reviewReason: null } });
                return created;
            });
            outcome = record ? await runRefund(record.id) : 'nothing_to_refund';
        }
        await audit(req, 'CONSULT_PAYMENT_RESOLVE', 'Consultation', id.data, { action: parse.data.action, reason: parse.data.reason, outcome });
        res.json({ outcome });
    } catch (e) { fail(res, e); }
});
