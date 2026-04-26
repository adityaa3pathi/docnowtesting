import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { generateReferralCode } from '../utils/referralService';

const router = express.Router();
const prisma = new PrismaClient();
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/g, '');

async function ensureReferralCode(userId: string, name?: string | null, existingCode?: string | null) {
    if (existingCode) return existingCode;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const nextCode = generateReferralCode(name);
        try {
            const updated = await prisma.user.update({
                where: { id: userId },
                data: { referralCode: nextCode },
                select: { referralCode: true }
            });
            return updated.referralCode!;
        } catch (error: any) {
            if (error?.code === 'P2002') continue;
            throw error;
        }
    }

    throw new Error('Failed to generate a unique referral code');
}

// GET /api/profile - Get current user's profile
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                id: true,
                name: true,
                email: true,
                mobile: true,
                isVerified: true,
                gender: true,
                age: true,
                createdAt: true,
                wallet: {
                    select: {
                        balance: true
                    }
                }
            }
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.status(200).json(user);
    } catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PUT /api/profile - Update user profile
router.put('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { gender, age, email } = req.body;

        // Validate at least one field is provided
        if (gender === undefined && age === undefined && email === undefined) {
            res.status(400).json({ error: 'At least one field to update is required' });
            return;
        }

        const updateData: any = {};
        if (gender !== undefined) updateData.gender = gender;
        if (age !== undefined) updateData.age = parseInt(age);
        if (email !== undefined) updateData.email = email;

        const updatedUser = await prisma.user.update({
            where: { id: req.userId },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                mobile: true,
                gender: true,
                age: true,
                isVerified: true
            }
        });

        res.status(200).json({
            message: 'Profile updated successfully',
            user: updatedUser
        });
    } catch (error: any) {
        console.error('Update Profile Error:', error);
        if (error.code === 'P2025') {
            // Record to update not found - likely due to DB reset while using old token
            res.status(404).json({ error: 'User not found. Please log in again.' });
            return;
        }
        if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
            res.status(400).json({ error: 'This email is already in use.' });
            return;
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PUT /api/profile/password - Update user password
router.put('/password', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            res.status(400).json({ error: 'Current password and new password are required' });
            return;
        }

        if (newPassword.length < 6) {
            res.status(400).json({ error: 'New password must be at least 6 characters' });
            return;
        }
        if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
            res.status(400).json({ error: 'New password must contain at least one letter and one number' });
            return;
        }

        const user = await prisma.user.findUnique({ where: { id: req.userId } });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        if (!user.password) {
            res.status(400).json({ error: 'Password is not set. Please use forgot password or contact support.' });
            return;
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            res.status(401).json({ error: 'Incorrect current password' });
            return;
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: req.userId },
            data: { password: hashedNewPassword }
        });

        res.status(200).json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Update Password Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/profile/wallet - Get user wallet balance + recent transactions
router.get('/wallet', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const wallet = await prisma.wallet.findUnique({
            where: { userId: req.userId },
            include: {
                ledger: {
                    orderBy: { createdAt: 'desc' },
                    take: 20
                }
            }
        });

        res.json({
            balance: wallet?.balance ?? 0,
            transactions: wallet?.ledger ?? []
        });
    } catch (error) {
        console.error('Get Wallet Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/profile/referrals - Get referral center data
router.get('/referrals', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const baseUser = await prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                id: true,
                name: true,
                mobile: true,
                referralCode: true
            }
        });

        if (!baseUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const referralCode = await ensureReferralCode(baseUser.id, baseUser.name, baseUser.referralCode);

        const [configs, referredUsers, rewardRows] = await Promise.all([
            prisma.systemConfig.findMany({
                where: {
                    key: {
                        in: ['REFERRAL_BONUS_REFEREE', 'REFERRAL_BONUS_REFERRER']
                    }
                },
                select: {
                    key: true,
                    value: true
                }
            }),
            prisma.user.findMany({
                where: { referredById: req.userId },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    name: true,
                    mobile: true,
                    createdAt: true
                }
            }),
            prisma.referralReward.findMany({
                where: {
                    OR: [
                        { referrerId: req.userId, rewardType: 'REFERRER_ORDER' },
                        { refereeId: req.userId, rewardType: 'REFEREE_SIGNUP' }
                    ]
                },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    referrerId: true,
                    refereeId: true,
                    rewardType: true,
                    amount: true,
                    status: true,
                    triggerEvent: true,
                    processedAt: true,
                    createdAt: true,
                    referrer: {
                        select: {
                            id: true,
                            name: true,
                            mobile: true
                        }
                    }
                }
            })
        ]);

        const typedConfigs = configs as Array<{ key: string; value: string }>;
        const typedReferredUsers = referredUsers as Array<{ id: string; name: string | null; mobile: string; createdAt: Date }>;
        const typedRewardRows = rewardRows as Array<{
            id: string;
            referrerId: string;
            refereeId: string;
            rewardType: string;
            amount: number;
            status: string;
            triggerEvent: string;
            processedAt: Date | null;
            createdAt: Date;
        }>;

        const refereeReward = typedConfigs.find((config) => config.key === 'REFERRAL_BONUS_REFEREE');
        const referrerReward = typedConfigs.find((config) => config.key === 'REFERRAL_BONUS_REFERRER');
        const latestOrderRewards = new Map(
            typedRewardRows
                .filter((reward) => reward.rewardType === 'REFERRER_ORDER' && reward.referrerId === req.userId)
                .map((reward) => [reward.refereeId, reward])
        );

        const userLookup = new Map(
            typedReferredUsers.map((user) => [user.id, user])
        );

        const referrals = typedReferredUsers.map((user) => ({
            id: user.id,
            name: user.name,
            mobile: user.mobile,
            joinedAt: user.createdAt,
            status: latestOrderRewards.has(user.id) ? 'ORDER_COMPLETED' : 'SIGNED_UP'
        }));

        const rewardHistory = typedRewardRows.map((reward) => {
            const relatedReferee = userLookup.get(reward.refereeId);
            const isSignupBonusForCurrentUser = reward.rewardType === 'REFEREE_SIGNUP' && reward.refereeId === req.userId;

            return {
                id: reward.id,
                rewardType: reward.rewardType,
                amount: reward.amount,
                processedAt: reward.processedAt,
                createdAt: reward.createdAt,
                triggerEvent: reward.triggerEvent,
                status: reward.status,
                refereeName: relatedReferee?.name || (isSignupBonusForCurrentUser ? baseUser.name : null),
                refereeMobile: relatedReferee?.mobile || (isSignupBonusForCurrentUser ? baseUser.mobile : null),
                isBeneficiaryReferee: isSignupBonusForCurrentUser
            };
        });

        const totalEarnings = rewardHistory
            .filter((reward) => reward.status === 'PROCESSED')
            .reduce((sum, reward) => sum + reward.amount, 0);

        res.json({
            referralCode,
            shareLink: `${APP_BASE_URL}/?ref=${encodeURIComponent(referralCode)}`,
            rewardsConfig: {
                refereeBonus: parseFloat(refereeReward?.value || '50'),
                referrerBonus: parseFloat(referrerReward?.value || '100')
            },
            stats: {
                totalReferrals: referrals.length,
                totalEarnings
            },
            referrals,
            rewardHistory
        });
    } catch (error) {
        console.error('Get Referral Center Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
