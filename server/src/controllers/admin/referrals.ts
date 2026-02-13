import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

/**
 * GET /api/admin/referrals/stats — Referral Statistics & Leaderboard
 */
export async function getReferralStats(req: AuthRequest, res: Response) {
    try {
        const [
            totalReferrals,
            rewardsDistributed,
            pendingRewardsCount
        ] = await Promise.all([
            prisma.user.count({ where: { referredById: { not: null } } }),
            prisma.referralReward.aggregate({
                where: { status: 'PROCESSED' },
                _sum: { amount: true }
            }),
            prisma.referralReward.count({ where: { status: 'PENDING' } })
        ]);

        const leaderboard = await prisma.user.findMany({
            where: {
                referrals: { some: {} }
            },
            select: {
                id: true,
                name: true,
                mobile: true,
                referralCode: true,
                _count: { select: { referrals: true } },
                wallet: { select: { ledger: { where: { type: 'CREDIT', description: { contains: 'Referral' } } } } }
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

        const recentActivity = await prisma.user.findMany({
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
            status: u.isVerified ? 'COMPLETED' : 'PENDING_VERIFICATION'
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

    } catch (error) {
        console.error('[Admin] Error fetching referral stats:', error);
        res.status(500).json({ error: 'Failed to fetch referral stats' });
    }
}
