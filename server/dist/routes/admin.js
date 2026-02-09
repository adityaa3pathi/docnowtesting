"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const adminAuth_1 = require("../middleware/adminAuth");
const db_1 = require("../db");
const router = (0, express_1.Router)();
console.log('Admin Router Loaded');
// Helper to get client IP address
function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded)) {
        return forwarded[0] || 'unknown';
    }
    return req.socket?.remoteAddress || 'unknown';
}
// ============================================
// All routes require: authMiddleware -> requireSuperAdmin
// ============================================
// GET /api/admin/health - Health check
router.get('/health', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, (req, res) => {
    console.log('[Admin] Health check passed for:', req.adminName);
    res.json({
        status: 'ok',
        admin: req.adminName,
        timestamp: new Date().toISOString()
    });
});
// ============================================
// DASHBOARD STATS
// ============================================
// GET /api/admin/stats - Dashboard KPIs
router.get('/stats', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [totalUsers, newUsersToday, totalOrders, ordersToday, pendingReports, totalWalletBalance, referralPayoutsThisWeek] = await Promise.all([
            db_1.prisma.user.count({ where: { role: 'USER' } }),
            db_1.prisma.user.count({ where: { role: 'USER', createdAt: { gte: today } } }),
            db_1.prisma.booking.count(),
            db_1.prisma.booking.count({ where: { createdAt: { gte: today } } }),
            db_1.prisma.booking.count({ where: { status: { not: 'Report Generated' } } }),
            db_1.prisma.walletLedger.aggregate({ _sum: { amount: true } }),
            db_1.prisma.referralReward.aggregate({
                where: {
                    status: 'PROCESSED',
                    processedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                },
                _sum: { amount: true }
            })
        ]);
        // Calculate total revenue (sum of all bookings)
        const revenueResult = await db_1.prisma.booking.aggregate({
            _sum: { totalAmount: true }
        });
        res.json({
            totalRevenue: revenueResult._sum.totalAmount || 0,
            totalUsers,
            newUsersToday,
            totalOrders,
            ordersToday,
            pendingReports,
            totalWalletBalance: totalWalletBalance._sum.amount || 0,
            referralPayoutsThisWeek: referralPayoutsThisWeek._sum.amount || 0
        });
    }
    catch (error) {
        console.error('[Admin] Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});
// ============================================
// USERS
// ============================================
// GET /api/admin/users - List all users (paginated)
router.get('/users', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const statusFilter = req.query.status;
        const where = { role: 'USER' };
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
        const users = await db_1.prisma.user.findMany({
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
        const total = await db_1.prisma.user.count({ where });
        const formatted = users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            mobile: u.mobile,
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
    }
    catch (error) {
        console.error('[Admin] Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});
// GET /api/admin/users/:id - User details
router.get('/users/:id', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
            include: {
                wallet: {
                    include: {
                        ledger: { orderBy: { createdAt: 'desc' }, take: 20 }
                    }
                },
                bookings: {
                    orderBy: { createdAt: 'desc' },
                    take: 10
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
    }
    catch (error) {
        console.error('[Admin] Error fetching user details:', error);
        res.status(500).json({ error: 'Failed to fetch user details' });
    }
});
// PUT /api/admin/users/:id/status - Block/Unblock user
router.put('/users/:id/status', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { status, reason } = req.body;
        if (!['ACTIVE', 'BLOCKED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be ACTIVE or BLOCKED' });
        }
        const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const oldStatus = user.status;
        const clientIP = getClientIP(req);
        await db_1.prisma.$transaction([
            db_1.prisma.user.update({
                where: { id: userId },
                data: { status }
            }),
            db_1.prisma.adminAuditLog.create({
                data: {
                    adminId: req.adminId,
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
    }
    catch (error) {
        console.error('[Admin] Error updating user status:', error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
});
// ============================================
// SYSTEM CONFIG
// ============================================
// GET /api/admin/config - Get all configs
router.get('/config', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const configs = await db_1.prisma.systemConfig.findMany();
        res.json({ configs });
    }
    catch (error) {
        console.error('[Admin] Error fetching configs:', error);
        res.status(500).json({ error: 'Failed to fetch configs' });
    }
});
// PUT /api/admin/config/:key - Update config
router.put('/config/:key', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const configKey = req.params.key;
        const { value, reason } = req.body;
        if (!value) {
            return res.status(400).json({ error: 'Value is required' });
        }
        const existing = await db_1.prisma.systemConfig.findUnique({ where: { key: configKey } });
        const oldValue = existing?.value;
        const clientIP = getClientIP(req);
        const config = await db_1.prisma.systemConfig.upsert({
            where: { key: configKey },
            update: { value, updatedBy: req.adminId },
            create: { key: configKey, value, updatedBy: req.adminId }
        });
        await db_1.prisma.adminAuditLog.create({
            data: {
                adminId: req.adminId,
                adminName: req.adminName || 'Admin',
                action: 'CONFIG_UPDATED',
                entity: 'SystemConfig',
                targetId: configKey,
                oldValue: oldValue ? { value: oldValue } : undefined,
                newValue: { value, reason: reason || '' },
                ipAddress: clientIP
            }
        });
        res.json({ success: true, config });
    }
    catch (error) {
        console.error('[Admin] Error updating config:', error);
        res.status(500).json({ error: 'Failed to update config' });
    }
});
// ============================================
// WALLETS
// ============================================
// POST /api/admin/wallets/adjust - Credit/Debit user wallet
router.post('/wallets/adjust', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const { userId, type, amount, reason } = req.body;
        if (!userId || !type || !amount || !reason) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!['CREDIT', 'DEBIT'].includes(type)) {
            return res.status(400).json({ error: 'Invalid transaction type' });
        }
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        const user = await db_1.prisma.user.findUnique({
            where: { id: userId },
            include: { wallet: true }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Ensure user has a wallet
        let wallet = user.wallet;
        if (!wallet) {
            wallet = await db_1.prisma.wallet.create({ data: { userId } });
        }
        const clientIP = getClientIP(req);
        // Perform transaction
        const result = await db_1.prisma.$transaction(async (tx) => {
            // calculated amount based on type
            const signedAmount = type === 'CREDIT' ? numericAmount : -numericAmount;
            // Check sufficiency for debit
            // Note: balance is calculated from ledger, but we can't easily query sum in transaction here without raw query
            // For now, we trust the ledger sum logic or fetching latest balance
            const currentBalance = await tx.walletLedger.aggregate({
                where: { walletId: wallet.id },
                _sum: { amount: true }
            });
            const balance = currentBalance._sum.amount || 0;
            if (type === 'DEBIT' && balance < numericAmount) {
                throw new Error('Insufficient wallet balance');
            }
            const newBalance = balance + signedAmount;
            // Create ledger entry
            const ledgerEntry = await tx.walletLedger.create({
                data: {
                    walletId: wallet.id,
                    type: type,
                    amount: signedAmount,
                    balanceAfter: newBalance,
                    description: reason,
                    referenceType: 'ADMIN_ADJUSTMENT',
                    referenceId: `ADMIN-${Date.now()}`, // Simple unique ref
                    createdById: req.adminId, // Track which admin did this
                    ipAddress: clientIP
                }
            });
            // Audit log
            await tx.adminAuditLog.create({
                data: {
                    adminId: req.adminId,
                    adminName: req.adminName || 'Admin',
                    action: 'WALLET_ADJUSTMENT',
                    entity: 'Wallet',
                    targetId: wallet.id,
                    oldValue: { balance },
                    newValue: { balance: newBalance, amount: signedAmount, reason },
                    ipAddress: clientIP,
                    isDestructive: type === 'DEBIT'
                }
            });
            return { ledgerEntry, newBalance };
        });
        res.json({ success: true, ...result });
    }
    catch (error) {
        console.error('[Admin] Error adjusting wallet:', error);
        res.status(400).json({ error: error.message || 'Failed to adjust wallet' });
    }
});
// GET /api/admin/wallets/ledger - System-wide ledger
router.get('/wallets/ledger', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const type = req.query.type; // CREDIT | DEBIT
        const search = req.query.search;
        const where = {};
        if (type && ['CREDIT', 'DEBIT'].includes(type)) {
            where.type = type;
        }
        if (search) {
            where.wallet = {
                user: {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { mobile: { contains: search } },
                        { email: { contains: search, mode: 'insensitive' } }
                    ]
                }
            };
        }
        const ledger = await db_1.prisma.walletLedger.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                wallet: {
                    include: {
                        user: { select: { id: true, name: true, mobile: true, email: true } }
                    }
                }
            }
        });
        const total = await db_1.prisma.walletLedger.count({ where });
        // Map response to flatten structure slightly
        const formatted = ledger.map(entry => ({
            id: entry.id,
            type: entry.type,
            amount: entry.amount,
            balanceAfter: entry.balanceAfter,
            description: entry.description,
            referenceType: entry.referenceType,
            referenceId: entry.referenceId,
            createdAt: entry.createdAt,
            user: entry.wallet.user,
            adminId: entry.createdById // Could fetch admin name if needed, but ID is okay for now
        }));
        res.json({
            ledger: formatted,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    }
    catch (error) {
        console.error('[Admin] Error fetching wallet ledger:', error);
        res.status(500).json({ error: 'Failed to fetch wallet ledger' });
    }
});
// ============================================
// REFERRALS
// ============================================
// GET /api/admin/referrals/stats - Referral Statistics & Leaderboard
router.get('/referrals/stats', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const [totalReferrals, rewardsDistributed, pendingRewardsCount] = await Promise.all([
            db_1.prisma.user.count({ where: { referredById: { not: null } } }),
            db_1.prisma.referralReward.aggregate({
                where: { status: 'PROCESSED' },
                _sum: { amount: true }
            }),
            db_1.prisma.referralReward.count({ where: { status: 'PENDING' } })
        ]);
        // Get Top Referrers (Leaderboard)
        // Group by referrerId and count/sum rewards
        // Prisma doesn't support complex groupBy with relations easily, so we might need raw query or 2 steps
        // For now, let's fetch top users by referral count locally or find a cleaner way.
        // A raw query is most efficient here.
        const leaderboard = await db_1.prisma.user.findMany({
            where: {
                referrals: { some: {} } // Users who have referred at least one person
            },
            select: {
                id: true,
                name: true,
                mobile: true,
                referralCode: true,
                _count: { select: { referrals: true } },
                wallet: { select: { ledger: { where: { type: 'CREDIT', description: { contains: 'Referral' } } } } } // Approximation of earnings
            },
            orderBy: {
                referrals: { _count: 'desc' }
            },
            take: 10
        });
        const formattedLeaderboard = leaderboard.map(u => ({
            id: u.id,
            name: u.name,
            mobile: u.mobile,
            referralCode: u.referralCode,
            totalReferrals: u._count.referrals,
            totalEarnings: u.wallet?.ledger.reduce((acc, curr) => acc + curr.amount, 0) || 0
        }));
        // Recent Referral Activity
        const recentActivity = await db_1.prisma.user.findMany({
            where: { referredById: { not: null } },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
                referredBy: { select: { id: true, name: true, mobile: true } }
            }
        });
        const formattedActivity = recentActivity.map(u => ({
            id: u.id,
            refereeName: u.name,
            refereeMobile: u.mobile,
            referrerName: u.referredBy?.name,
            referrerMobile: u.referredBy?.mobile,
            date: u.createdAt,
            status: u.isVerified ? 'COMPLETED' : 'PENDING_VERIFICATION' // Simplified status logic
        }));
        res.json({
            stats: {
                totalReferrals,
                totalRewardsDistributed: rewardsDistributed._sum.amount || 0,
                pendingRewards: pendingRewardsCount
            },
            leaderboard: formattedLeaderboard,
            recentActivity: formattedActivity
        });
    }
    catch (error) {
        console.error('[Admin] Error fetching referral stats:', error);
        res.status(500).json({ error: 'Failed to fetch referral stats' });
    }
});
// ============================================
// ORDERS (BOOKINGS)
// ============================================
// GET /api/admin/orders - List all orders (paginated)
router.get('/orders', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search;
        const status = req.query.status;
        const where = {};
        if (status && status !== 'All') {
            where.status = status;
        }
        if (search) {
            where.OR = [
                { id: { contains: search, mode: 'insensitive' } },
                { partnerBookingId: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { mobile: { contains: search } } },
                { patient: { name: { contains: search, mode: 'insensitive' } } }
            ];
        }
        const orders = await db_1.prisma.booking.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, name: true, mobile: true, email: true } },
                items: {
                    include: {
                        patient: { select: { name: true, gender: true, age: true } }
                    }
                }
            }
        });
        const total = await db_1.prisma.booking.count({ where });
        res.json({
            orders: orders.map(order => ({
                id: order.id,
                partnerBookingId: order.partnerBookingId,
                date: order.createdAt,
                slotDate: order.slotDate,
                slotTime: order.slotTime,
                amount: order.totalAmount,
                status: order.status,
                user: order.user,
                // Take patient from the first item as primary patient for the booking list
                patient: order.items[0]?.patient || null,
                testNames: order.items.map(i => i.testName)
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    }
    catch (error) {
        console.error('[Admin] Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});
// GET /api/admin/stats/revenue - Revenue trend (Last 30 days)
router.get('/stats/revenue', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        // Generate last 30 days dates
        const days = 30;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        // Fetch bookings in range
        const bookings = await db_1.prisma.booking.groupBy({
            by: ['createdAt'],
            where: {
                createdAt: { gte: startDate },
                status: { not: 'Cancelled' } // Exclude cancelled orders
            },
            _sum: { totalAmount: true }
        });
        // Map database results to a daily format
        // Prisma groupBy on DateTime returns full timestamp, so we need to fetch and aggregate in JS or use raw SQL.
        // For simplicity and DB agnostic, let's fetch raw data or use Raw Query for date truncation if needed.
        // Actually, let's just fetch all bookings in range and aggregate in JS for now (assuming < 10k orders/month for MVP)
        // If scale increases, use `prisma.$queryRaw` with DATE_TRUNC (Postgres).
        const rawBookings = await db_1.prisma.booking.findMany({
            where: {
                createdAt: { gte: startDate },
                status: { not: 'Cancelled' }
            },
            select: { createdAt: true, totalAmount: true }
        });
        const revenueMap = {};
        // Initialize map with 0 for all days
        for (let i = 0; i <= days; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            revenueMap[dateStr] = 0;
        }
        // Fill with data
        rawBookings.forEach(booking => {
            const dateStr = booking.createdAt.toISOString().split('T')[0];
            if (revenueMap[dateStr] !== undefined) {
                revenueMap[dateStr] += booking.totalAmount;
            }
        });
        // Convert to array
        const chartData = Object.entries(revenueMap).map(([date, revenue]) => ({
            date: new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
            revenue
        }));
        res.json({ chartData });
    }
    catch (error) {
        console.error('[Admin] Error fetching revenue stats:', error);
        res.status(500).json({ error: 'Failed to fetch revenue stats' });
    }
});
// GET /api/admin/stats/high-value - Recent High Value Orders (Top 5 > 2000)
router.get('/stats/high-value', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const orders = await db_1.prisma.booking.findMany({
            where: { totalAmount: { gte: 2000 } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
                user: { select: { name: true, mobile: true } }
            }
        });
        res.json({ orders });
    }
    catch (error) {
        console.error('[Admin] Error fetching high value orders:', error);
        res.status(500).json({ error: 'Failed to fetch high value orders' });
    }
});
// ============================================
// AUDIT LOGS
// ============================================
// GET /api/admin/audit-logs - View audit logs
router.get('/audit-logs', auth_1.authMiddleware, adminAuth_1.requireSuperAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search;
        const action = req.query.action;
        const where = {};
        if (action && action !== 'All') {
            where.action = action;
        }
        if (search) {
            where.OR = [
                { adminName: { contains: search, mode: 'insensitive' } },
                { entity: { contains: search, mode: 'insensitive' } },
                { targetId: { contains: search, mode: 'insensitive' } }
            ];
        }
        const logs = await db_1.prisma.adminAuditLog.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' }
        });
        const total = await db_1.prisma.adminAuditLog.count({ where });
        res.json({
            logs,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    }
    catch (error) {
        console.error('[Admin] Error fetching audit logs:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});
exports.default = router;
