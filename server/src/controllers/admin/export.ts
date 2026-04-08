import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

export async function exportAdminData(req: AuthRequest, res: Response) {
    try {
        const entity = req.query.entity as string;
        if (!entity || !['users', 'orders', 'callbacks'].includes(entity)) {
            return res.status(400).json({ error: 'Invalid or missing entity for export. Must be "users", "orders", or "callbacks".' });
        }

        const search = (req.query.search as string) || '';
        const limitToExport = 10000; // Hard limit for safety

        if (entity === 'users') {
            const roleFilter = req.query.role as string;
            const statusFilter = req.query.status as string;
            const where: any = {};

            if (roleFilter && ['USER', 'MANAGER'].includes(roleFilter)) {
                where.role = roleFilter;
            } else {
                where.role = { in: ['USER', 'MANAGER'] };
            }

            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                    { mobile: { contains: search } }
                ];
            }

            if (statusFilter && (statusFilter === 'ACTIVE' || statusFilter === 'BLOCKED')) {
                where.status = statusFilter;
            }

            const users = await prisma.user.findMany({
                where,
                take: limitToExport,
                orderBy: { createdAt: 'desc' },
                include: {
                    _count: { select: { bookings: true } },
                    wallet: {
                        include: {
                            ledger: { orderBy: { createdAt: 'desc' }, take: 1 }
                        }
                    }
                }
            });

            // Format as CSV
            const headers = ['ID', 'Name', 'Email', 'Mobile', 'Role', 'Status', 'Referral Code', 'Total Orders', 'Wallet Balance', 'Created At'];
            const rows = users.map(u => [
                u.id,
                `"${u.name || ''}"`,
                `"${u.email || ''}"`,
                u.mobile,
                u.role,
                u.status,
                u.referralCode || '',
                u._count.bookings,
                u.wallet?.ledger[0]?.balanceAfter ?? 0,
                u.createdAt.toISOString()
            ]);

            const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="users-export.csv"');
            return res.status(200).send(csvContent);

        } else if (entity === 'orders') {
            const status = req.query.status as string;
            const where: any = {};

            if (status && status !== 'All') {
                where.status = status;
            }

            if (search) {
                where.OR = [
                    { id: { contains: search, mode: 'insensitive' } },
                    { partnerBookingId: { contains: search, mode: 'insensitive' } },
                    { user: { name: { contains: search, mode: 'insensitive' } } },
                    { user: { mobile: { contains: search } } },
                    { items: { some: { patient: { name: { contains: search, mode: 'insensitive' } } } } }
                ];
            }

            const orders = await prisma.booking.findMany({
                where,
                take: limitToExport,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: { select: { id: true, name: true, mobile: true, email: true } },
                    address: { select: { id: true, line1: true, city: true, pincode: true } },
                    items: {
                        include: {
                            patient: { select: { name: true, gender: true, age: true } }
                        }
                    }
                }
            });

            // Format as CSV
            const headers = ['Order ID', 'Healthians ID', 'Slot Date', 'Slot Time', 'Amount', 'Status', 'User Name', 'User Mobile', 'Patient Name', 'Tests'];
            const rows = orders.map(order => [
                order.id,
                order.partnerBookingId || '',
                order.slotDate,
                order.slotTime,
                order.totalAmount,
                order.status,
                `"${order.user.name || ''}"`,
                order.user.mobile,
                `"${order.items[0]?.patient?.name || ''}"`,
                `"${order.items.map(i => i.testName).join(', ')}"`
            ]);

            const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="orders-export.csv"');
            return res.status(200).send(csvContent);
        } else if (entity === 'callbacks') {
            const status = req.query.status as string;
            const where: any = {};

            if (status && status !== 'All') {
                where.status = status;
            }

            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { mobile: { contains: search } },
                    { city: { contains: search, mode: 'insensitive' } },
                ];
            }

            const callbacks = await prisma.callbackRequest.findMany({
                where,
                take: limitToExport,
                orderBy: { createdAt: 'desc' },
            });

            // Format as CSV
            const headers = ['ID', 'Name', 'Mobile', 'City', 'Status', 'Notes', 'Created At'];
            const rows = callbacks.map(cb => [
                cb.id,
                `"${cb.name || ''}"`,
                cb.mobile,
                `"${cb.city || ''}"`,
                cb.status,
                `"${cb.notes || ''}"`,
                cb.createdAt.toISOString()
            ]);

            const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="callbacks-export.csv"');
            return res.status(200).send(csvContent);
        }

    } catch (error) {
        console.error('[Admin] Error exporting data:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
}
