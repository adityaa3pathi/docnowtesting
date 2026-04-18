import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

const INVOICE_ELIGIBLE_BOOKING_STATUSES = new Set(['Order Booked', 'Sample Collector Assigned', 'Sample Collected', 'Report Generated', 'Completed']);
const INVOICE_ELIGIBLE_PARTNER_STATUSES = new Set(['BS002', 'BS005', 'BS007', 'BS008', 'BS015']);

function canSendInvoiceForBooking(booking: {
    paymentStatus: string;
    status: string;
    partnerBookingId?: string | null;
    partnerStatus?: string | null;
    managerOrder?: { status: string } | null;
}) {
    if (booking.paymentStatus !== 'CONFIRMED') return false;
    if (!booking.partnerBookingId) return false;
    if (booking.managerOrder?.status === 'CONFIRMED') return true;
    if (booking.partnerStatus && INVOICE_ELIGIBLE_PARTNER_STATUSES.has(booking.partnerStatus)) return true;
    return INVOICE_ELIGIBLE_BOOKING_STATUSES.has(booking.status);
}

/**
 * GET /api/admin/orders — List all orders (paginated)
 */
export async function listOrders(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = req.query.search as string;
        const status = req.query.status as string;
        const dateFrom = req.query.dateFrom as string;
        const dateTo = req.query.dateTo as string;

        const where: any = {};

        if (status && status !== 'All') {
            where.status = status;
        }

        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) {
                where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
            }
            if (dateTo) {
                const end = new Date(`${dateTo}T00:00:00.000Z`);
                end.setUTCDate(end.getUTCDate() + 1);
                where.createdAt.lt = end;
            }
        }

        if (search) {
            where.OR = [
                { id: { contains: search, mode: 'insensitive' } },
                { partnerBookingId: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { mobile: { contains: search } } },
                { items: { some: { patient: { name: { contains: search, mode: 'insensitive' } } } } },
                { items: { some: { testName: { contains: search, mode: 'insensitive' } } } }
            ];
        }

        const orders = await prisma.booking.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, name: true, mobile: true, email: true } },
                address: { select: { id: true, line1: true, city: true, pincode: true } },
                managerOrder: { select: { id: true, status: true, managerId: true } },
                items: {
                    include: {
                        patient: { select: { name: true, relation: true, gender: true, age: true } }
                    }
                },
                reports: {
                    select: {
                        id: true,
                        fetchStatus: true,
                        generatedAt: true,
                    },
                    orderBy: { generatedAt: 'desc' },
                    take: 1,
                },
                _count: {
                    select: {
                        reports: true,
                    }
                }
            }
        });

        const total = await prisma.booking.count({ where });
        const orderIds = orders.map((order) => order.id);
        const [invoiceAuditLogs, reportAuditLogs] = await Promise.all([
            orderIds.length > 0
                ? prisma.adminAuditLog.findMany({
                    where: {
                        action: 'MANAGER_INVOICE_SENT',
                        entity: 'Booking',
                        targetId: { in: orderIds },
                    },
                    orderBy: { createdAt: 'desc' },
                })
                : Promise.resolve([]),
            orderIds.length > 0
                ? prisma.adminAuditLog.findMany({
                    where: {
                        action: 'MANAGER_REPORT_SENT',
                        entity: 'Booking',
                        targetId: { in: orderIds },
                    },
                    orderBy: { createdAt: 'desc' },
                })
                : Promise.resolve([]),
        ]);
        const invoiceAuditByBookingId = new Map<string, string>();
        invoiceAuditLogs.forEach((log) => {
            if (log.targetId && !invoiceAuditByBookingId.has(log.targetId)) {
                invoiceAuditByBookingId.set(log.targetId, log.createdAt.toISOString());
            }
        });
        const reportAuditByBookingId = new Map<string, string>();
        reportAuditLogs.forEach((log) => {
            if (log.targetId && !reportAuditByBookingId.has(log.targetId)) {
                reportAuditByBookingId.set(log.targetId, log.createdAt.toISOString());
            }
        });

        res.json({
            orders: orders.map(order => ({
                id: order.id,
                partnerBookingId: order.partnerBookingId,
                date: order.createdAt,
                slotDate: order.slotDate,
                slotTime: order.slotTime,
                amount: order.totalAmount,
                status: order.status,
                paymentStatus: order.paymentStatus,
                user: order.user,
                address: order.address,
                managerOrder: order.managerOrder,
                patient: order.items[0]?.patient || null,
                testNames: order.items.map(i => i.testName),
                reportCount: order._count.reports,
                latestReportId: order.reports[0]?.id || null,
                latestReportStatus: order.reports[0]?.fetchStatus || null,
                canSendInvoice: canSendInvoiceForBooking(order),
                invoiceSentAt: invoiceAuditByBookingId.get(order.id) || null,
                canSendReport: Boolean(order.reports[0]?.id),
                reportSentAt: reportAuditByBookingId.get(order.id) || null,
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Admin] Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
}
