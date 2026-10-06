/**
 * Consultation repair job. Same 5-minute cadence as the lab reconciler, with its own lock.
 * Every step is a conditional update, so an overlapping run or a run without the lock is harmless.
 * A hold is expired only after Razorpay confirms nothing was paid on its order.
 */
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { Redis } from '@upstash/redis';
import { prisma } from '../db';
import { confirmPayment } from '../modules/consultations/consultations.payments';
import { ConsultRazorpay, RazorpayPayment, realConsultRazorpay } from '../modules/consultations/consultations.razorpay';
import { MAX_REFUND_ATTEMPTS, markRefundFailed, markRefundProcessed, runRefund } from '../modules/consultations/consultations.refunds';
import { OPEN_PAYMENT_STATUSES } from '../modules/consultations/consultations.types';
import { expireHold } from '../modules/consultations/consultations.transitions';
import { logAlert, logger } from '../utils/logger';

export const LIMITS = {
    batch: 50,
    openPaymentMinAgeMs: 3 * 60_000,
    orphanMinAgeMs: 2 * 60_000,
    lookbackMs: 48 * 3_600_000,
    expiredRecheckMs: 60 * 60_000,
    freshOrderMs: 2 * 3_600_000,
    refundMinAgeMs: 60_000,
    unprocessedEventMs: 10 * 60_000,
    flaggedMs: 60 * 60_000,
};

export type CycleDeps = {
    db?: PrismaClient;
    razorpay?: ConsultRazorpay;
    now?: () => Date;
    alert?: (name: string, data?: Record<string, unknown>) => void;
};

export async function runConsultCycle(deps: CycleDeps = {}) {
    const db = deps.db ?? prisma;
    const razorpay = deps.razorpay ?? realConsultRazorpay();
    const now = (deps.now ?? (() => new Date()))();
    const alert = deps.alert ?? ((name, data) => logAlert(name, data));
    let razorpayDown = false;

    // One bad row never stops the batch. A network failure is remembered so the cycle raises one alert.
    async function each<T>(label: string, rows: T[], fn: (row: T) => Promise<void>) {
        for (const row of rows) {
            try {
                await fn(row);
            } catch (e: any) {
                if (e?.kind === 'network') razorpayDown = true;
                else logger.warn({ label, error: e?.message }, 'consult_reconciler_row_failed');
            }
        }
    }
    // One lookup per order per cycle, so a hold expired in step 2 is not asked about again in step 3.
    const lookups = new Map<string, Promise<RazorpayPayment[]>>();
    const capturedOn = async (orderId: string) => {
        if (!lookups.has(orderId)) lookups.set(orderId, razorpay.fetchOrderPayments(orderId));
        return (await lookups.get(orderId)!).filter((p) => p.status === 'captured');
    };
    const confirmCaptured = async (orderId: string) => {
        const captured = await capturedOn(orderId);
        for (const p of captured) await confirmPayment({ paymentId: p.id, orderId, amountPaise: p.amount, currency: p.currency }, { db, now: () => now });
        return captured.length;
    };

    // 1. A crash after creating the order but before storing its id: find the order by receipt.
    const orphans = await db.consultation.findMany({
        where: { status: { in: OPEN_PAYMENT_STATUSES }, payments: { none: {} }, createdAt: { lt: new Date(now.getTime() - LIMITS.orphanMinAgeMs), gt: new Date(now.getTime() - LIMITS.lookbackMs) } },
        orderBy: { createdAt: 'desc' },
        take: LIMITS.batch,
    });
    await each('orphan', orphans, async (c) => {
        const order = await razorpay.findOrderByReceipt(c.orderReceipt);
        if (order) await db.consultationPayment.create({ data: { consultationId: c.id, razorpayOrderId: order.id, amountPaise: order.amount } });
    });

    // 2. Lapsed holds: confirm if Razorpay shows a captured payment, otherwise expire and free the slot.
    const lapsed = await db.consultation.findMany({
        where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lt: now } },
        include: { payments: true },
        take: LIMITS.batch,
    });
    await each('lapsed', lapsed, async (c) => {
        let paid = 0;
        for (const orderId of new Set(c.payments.map((p) => p.razorpayOrderId))) paid += await confirmCaptured(orderId);
        if (paid === 0) await db.$transaction((tx) => expireHold(tx, c.id));
    });

    // 3. Open payments whose notice never arrived, including late ones on expired holds.
    // Orders on live holds, and expired ones under 2 hours old, are checked every cycle. Older
    // expired ones only hourly, oldest check first, so abandoned orders cannot crowd out real ones.
    const recheckBefore = new Date(now.getTime() - LIMITS.expiredRecheckMs);
    const freshAfter = new Date(now.getTime() - LIMITS.freshOrderMs);
    const open = await db.consultationPayment.findMany({
        where: {
            status: 'CREATED',
            razorpayPaymentId: null,
            createdAt: { lt: new Date(now.getTime() - LIMITS.openPaymentMinAgeMs), gt: new Date(now.getTime() - LIMITS.lookbackMs) },
            OR: [
                { consultation: { status: 'PENDING_PAYMENT' } },
                { consultation: { status: 'EXPIRED' }, OR: [{ updatedAt: { lt: recheckBefore } }, { createdAt: { gt: freshAfter } }] },
            ],
        },
        orderBy: { updatedAt: 'asc' },
        take: LIMITS.batch,
    });
    await each('open', open, async (p) => {
        const found = await confirmCaptured(p.razorpayOrderId);
        if (found === 0) await db.consultationPayment.updateMany({ where: { id: p.id }, data: { updatedAt: now } });
    });

    // 4. Pending refunds: send the ones never sent, poll the ones in flight.
    const refunds = await db.consultationRefund.findMany({
        where: { status: 'PENDING', attempts: { lt: MAX_REFUND_ATTEMPTS }, updatedAt: { lt: new Date(now.getTime() - LIMITS.refundMinAgeMs) } },
        include: { payment: true },
        take: LIMITS.batch,
    });
    await each('refund', refunds, async (r) => {
        if (!r.razorpayRefundId) {
            await runRefund(r.id, { db, razorpay });
            return;
        }
        const live = await razorpay.fetchRefund(r.payment.razorpayPaymentId!, r.razorpayRefundId);
        if (live.status === 'processed') await db.$transaction((tx) => markRefundProcessed(tx, r.id));
        if (live.status === 'failed') {
            await markRefundFailed(db, r.id, 'Razorpay reported the refund failed', true);
        }
    });

    // 5. Things only staff or an engineer can fix: raised once per cycle, as counts.
    const stuckEvents = await db.webhookEventV2.count({
        where: { source: 'razorpay_consult', processed: false, createdAt: { lt: new Date(now.getTime() - LIMITS.unprocessedEventMs) } },
    });
    if (stuckEvents > 0) alert('consult_webhook_events_unprocessed', { count: stuckEvents });
    const flagged = await db.consultation.count({
        where: { reviewReason: { not: null }, status: { in: OPEN_PAYMENT_STATUSES }, updatedAt: { lt: new Date(now.getTime() - LIMITS.flaggedMs) } },
    });
    if (flagged > 0) alert('consult_payments_awaiting_staff', { count: flagged });
    if (razorpayDown) alert('consult_reconciler_razorpay_unreachable');

    return { orphans: orphans.length, lapsed: lapsed.length, open: open.length, refunds: refunds.length };
}

const redis = process.env.UPSTASH_REDIS_REST_URL
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

export function startConsultReconciler() {
    logger.info({ schedule: '*/5 * * * *' }, 'consult_reconciler_started');
    cron.schedule('*/5 * * * *', async () => {
        const lockKey = 'consult-reconciler:lock';
        let locked = false;
        if (redis) {
            try {
                locked = !!(await redis.set(lockKey, 'locked', { nx: true, ex: 270 }));
                if (!locked) return;
            } catch (err) {
                logger.error({ error: err }, 'consult_reconciler_redis_lock_failed');
            }
        }
        try {
            await runConsultCycle();
        } catch (err) {
            logAlert('consult_reconciler_cycle_failed', { error: err });
        } finally {
            if (locked) {
                try { await redis!.del(lockKey); } catch { /* the lock expires on its own */ }
            }
        }
    });
}
