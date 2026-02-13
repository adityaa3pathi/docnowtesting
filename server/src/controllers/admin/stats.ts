import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

/**
 * GET /api/admin/stats — Dashboard KPIs
 */
export async function getDashboardStats(req: AuthRequest, res: Response) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
            totalUsers,
            newUsersToday,
            totalOrders,
            ordersToday,
            pendingReports,
            totalWalletBalance,
            referralPayoutsThisWeek
        ] = await Promise.all([
            prisma.user.count({ where: { role: 'USER' } }),
            prisma.user.count({ where: { role: 'USER', createdAt: { gte: today } } }),
            prisma.booking.count(),
            prisma.booking.count({ where: { createdAt: { gte: today } } }),
            prisma.booking.count({ where: { status: { not: 'Report Generated' } } }),
            prisma.walletLedger.aggregate({ _sum: { amount: true } }),
            prisma.referralReward.aggregate({
                where: {
                    status: 'PROCESSED',
                    processedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                },
                _sum: { amount: true }
            })
        ]);

        const revenueResult = await prisma.booking.aggregate({
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
    } catch (error) {
        console.error('[Admin] Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
}

/**
 * GET /api/admin/stats/revenue — Revenue trend (Last 30 days)
 */
export async function getRevenueTrend(req: AuthRequest, res: Response) {
    try {
        const days = 30;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const rawBookings = await prisma.booking.findMany({
            where: {
                createdAt: { gte: startDate },
                status: { not: 'Cancelled' }
            },
            select: { createdAt: true, totalAmount: true }
        });

        const revenueMap: Record<string, number> = {};

        for (let i = 0; i <= days; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            revenueMap[dateStr] = 0;
        }

        rawBookings.forEach(booking => {
            const dateStr = booking.createdAt.toISOString().split('T')[0];
            if (revenueMap[dateStr] !== undefined) {
                revenueMap[dateStr] += booking.totalAmount;
            }
        });

        const chartData = Object.entries(revenueMap).map(([date, revenue]) => ({
            date: new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
            revenue
        }));

        res.json({ chartData });
    } catch (error) {
        console.error('[Admin] Error fetching revenue stats:', error);
        res.status(500).json({ error: 'Failed to fetch revenue stats' });
    }
}

/**
 * GET /api/admin/stats/high-value — Recent High Value Orders (Top 5 > 2000)
 */
export async function getHighValueOrders(req: AuthRequest, res: Response) {
    try {
        const orders = await prisma.booking.findMany({
            where: { totalAmount: { gte: 2000 } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
                user: { select: { name: true, mobile: true } }
            }
        });

        res.json({ orders });
    } catch (error) {
        console.error('[Admin] Error fetching high value orders:', error);
        res.status(500).json({ error: 'Failed to fetch high value orders' });
    }
}
