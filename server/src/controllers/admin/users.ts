import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getClientIP } from '../../utils/adminHelpers';

/**
 * GET /api/admin/users — List all users (paginated)
 */
export async function listUsers(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = (req.query.search as string) || '';
        const statusFilter = req.query.status as string;

        const roleFilter = req.query.role as string;
        const where: any = {};

        // Filter by role: default to USER+MANAGER, or specific role if provided
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
            skip: (page - 1) * limit,
            take: limit,
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

        const total = await prisma.user.count({ where });

        const formatted = users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            mobile: u.mobile,
            role: u.role,
            status: u.status,
            referralCode: u.referralCode,
            totalOrders: u._count.bookings,
            walletBalance: u.wallet?.ledger[0]?.balanceAfter ?? 0,
            createdAt: u.createdAt
        }));

        res.json({
            users: formatted,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Admin] Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
}

/**
 * GET /api/admin/users/:id — User details
 */
export async function getUserDetails(req: AuthRequest, res: Response) {
    try {
        const userId = req.params.id as string;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                wallet: {
                    include: {
                        ledger: { orderBy: { createdAt: 'desc' }, take: 20 }
                    }
                },
                bookings: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    include: {
                        items: {
                            include: { patient: true }
                        },
                        reports: true,
                        address: true
                    }
                },
                referredBy: true,
                _count: { select: { referrals: true } }
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                role: user.role,
                status: user.status,
                referralCode: user.referralCode,
                createdAt: user.createdAt
            },
            wallet: {
                balance: user.wallet?.ledger[0]?.balanceAfter ?? 0
            },
            walletLedger: user.wallet?.ledger || [],
            orders: user.bookings,
            referralInfo: {
                referredBy: user.referredBy ? { id: user.referredBy.id, name: user.referredBy.name, mobile: user.referredBy.mobile } : null,
                referredCount: user._count.referrals
            }
        });
    } catch (error) {
        console.error('[Admin] Error fetching user details:', error);
        res.status(500).json({ error: 'Failed to fetch user details' });
    }
}

/**
 * PUT /api/admin/users/:id/status — Block/Unblock user
 */
export async function updateUserStatus(req: AuthRequest, res: Response) {
    try {
        const userId = req.params.id as string;
        const { status, reason } = req.body;

        if (!['ACTIVE', 'BLOCKED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be ACTIVE or BLOCKED' });
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const oldStatus = user.status;
        const clientIP = getClientIP(req);

        await prisma.$transaction([
            prisma.user.update({
                where: { id: userId },
                data: { status }
            }),
            prisma.adminAuditLog.create({
                data: {
                    adminId: req.adminId!,
                    adminName: req.adminName || 'Admin',
                    action: status === 'BLOCKED' ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
                    entity: 'User',
                    targetId: userId,
                    oldValue: { status: oldStatus },
                    newValue: { status, reason: reason || '' },
                    ipAddress: clientIP,
                    isDestructive: status === 'BLOCKED'
                }
            })
        ]);

        res.json({ success: true, message: `User ${status === 'BLOCKED' ? 'blocked' : 'unblocked'} successfully` });
    } catch (error) {
        console.error('[Admin] Error updating user status:', error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
}

/**
 * PUT /api/admin/users/:id/role — Promote/Demote user role (SUPER_ADMIN only)
 * Body: { role: 'USER' | 'MANAGER' }
 */
export async function updateUserRole(req: AuthRequest, res: Response) {
    try {
        const userId = req.params.id as string;
        const { role } = req.body;

        // Only allow setting USER or MANAGER (can't create SUPER_ADMINs via API)
        if (!['USER', 'MANAGER'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be USER or MANAGER' });
        }

        // Prevent self-demotion
        if (userId === req.adminId) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Can't modify other SUPER_ADMINs
        if (user.role === 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Cannot modify a SUPER_ADMIN role' });
        }

        const oldRole = user.role;
        const clientIP = getClientIP(req);

        await prisma.$transaction([
            prisma.user.update({
                where: { id: userId },
                data: { role }
            }),
            prisma.adminAuditLog.create({
                data: {
                    adminId: req.adminId!,
                    adminName: req.adminName || 'Admin',
                    action: role === 'MANAGER' ? 'USER_PROMOTED_MANAGER' : 'USER_DEMOTED_FROM_MANAGER',
                    entity: 'User',
                    targetId: userId,
                    oldValue: { role: oldRole },
                    newValue: { role },
                    ipAddress: clientIP,
                    isDestructive: role === 'USER'
                }
            })
        ]);

        res.json({
            success: true,
            message: `User role updated to ${role}`,
            user: { id: userId, name: user.name, mobile: user.mobile, role }
        });
    } catch (error) {
        console.error('[Admin] Error updating user role:', error);
        res.status(500).json({ error: 'Failed to update user role' });
    }
}
