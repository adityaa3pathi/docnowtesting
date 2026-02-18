import { nanoid } from 'nanoid';
import { prisma } from '../db';

// ============================================
// Config Keys — aligned with Admin UI
// ============================================
const CONFIG_KEY_REFEREE_BONUS = 'REFERRAL_BONUS_REFEREE';   // ₹ credited to the NEW user who signed up with a code
const CONFIG_KEY_REFERRER_BONUS = 'REFERRAL_BONUS_REFERRER'; // ₹ credited to the EXISTING user whose code was used

const DEFAULT_REFEREE_BONUS = 50;
const DEFAULT_REFERRER_BONUS = 100;

// ============================================
// Generate Referral Code
// ============================================
export function generateReferralCode(name?: string | null): string {
    const prefix = (name?.replace(/[^a-zA-Z]/g, '').substring(0, 3) || 'DOC').toUpperCase();
    return `${prefix}${nanoid(5).toUpperCase()}`;
}

// ============================================
// Read reward amount from SystemConfig
// ============================================
async function getRewardAmount(key: string, fallback: number): Promise<number> {
    try {
        const config = await prisma.systemConfig.findUnique({ where: { key } });
        if (config?.value) {
            const parsed = parseFloat(config.value);
            return isNaN(parsed) ? fallback : parsed;
        }
    } catch (e) {
        console.warn(`[Referral] Failed to read config ${key}, using default ${fallback}`);
    }
    return fallback;
}

// ============================================
// Award Signup Bonus (Referee gets ₹X)
//   Called after successful signup with a valid referral code.
//   Credits the NEW user's wallet.
// ============================================
export async function awardSignupBonus(referrerId: string, refereeId: string): Promise<void> {
    const amount = await getRewardAmount(CONFIG_KEY_REFEREE_BONUS, DEFAULT_REFEREE_BONUS);
    if (amount <= 0) return;

    try {
        await prisma.$transaction(async (tx) => {
            // Idempotency: @@unique([referrerId, refereeId, rewardType]) prevents duplicates
            const existing = await tx.referralReward.findFirst({
                where: { referrerId, refereeId, rewardType: 'REFEREE_SIGNUP' }
            });
            if (existing) {
                console.log(`[Referral] Signup bonus already awarded for referee ${refereeId}`);
                return;
            }

            // 1. Create reward record
            await tx.referralReward.create({
                data: {
                    referrerId,
                    refereeId,
                    rewardType: 'REFEREE_SIGNUP',
                    amount,
                    status: 'PROCESSED',
                    triggerEvent: 'SIGNUP',
                    processedAt: new Date()
                }
            });

            // 2. Credit referee's wallet
            const wallet = await tx.wallet.findUnique({ where: { userId: refereeId } });
            if (!wallet) {
                console.warn(`[Referral] Referee ${refereeId} has no wallet, skipping credit`);
                return;
            }

            await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: amount } }
            });

            // 3. Ledger entry
            const updatedWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
            await tx.walletLedger.create({
                data: {
                    walletId: wallet.id,
                    type: 'CREDIT',
                    amount: amount,
                    balanceAfter: updatedWallet!.balance,
                    description: `Referral signup bonus — welcome reward`,
                    referenceType: 'REFERRAL',
                    referenceId: refereeId
                }
            });

            console.log(`[Referral] Signup bonus ₹${amount} credited to referee ${refereeId}`);
        });
    } catch (error: any) {
        // P2002 = unique constraint violation (idempotency guard)
        if (error.code === 'P2002') {
            console.log(`[Referral] Duplicate signup bonus prevented for referee ${refereeId}`);
            return;
        }
        console.error('[Referral] Error awarding signup bonus:', error.message);
        // Non-critical: don't throw, user signup should still succeed
    }
}

// ============================================
// Award First-Order Bonus (Referrer gets ₹Y)
//   Called after a referred user's booking is CONFIRMED.
//   Credits the REFERRER's wallet.
// ============================================
export async function tryAwardFirstOrderBonus(userId: string, bookingId: string): Promise<void> {
    try {
        // 1. Check if user was referred
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { referredById: true }
        });

        if (!user?.referredById) return; // Not a referred user

        const referrerId = user.referredById;

        // 2. Check if referrer already got this reward for this referee
        const existingReward = await prisma.referralReward.findFirst({
            where: { referrerId, refereeId: userId, rewardType: 'REFERRER_ORDER' }
        });

        if (existingReward) return; // Already awarded, idempotent

        const amount = await getRewardAmount(CONFIG_KEY_REFERRER_BONUS, DEFAULT_REFERRER_BONUS);
        if (amount <= 0) return;

        await prisma.$transaction(async (tx) => {
            // 3. Create reward record
            await tx.referralReward.create({
                data: {
                    referrerId,
                    refereeId: userId,
                    rewardType: 'REFERRER_ORDER',
                    amount,
                    status: 'PROCESSED',
                    triggerEvent: 'FIRST_ORDER_COMPLETE',
                    triggerEntityId: bookingId,
                    processedAt: new Date()
                }
            });

            // 4. Credit referrer's wallet
            let wallet = await tx.wallet.findUnique({ where: { userId: referrerId } });
            if (!wallet) {
                // Auto-create wallet if missing (edge case for old users)
                wallet = await tx.wallet.create({ data: { userId: referrerId } });
            }

            await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: amount } }
            });

            // 5. Ledger entry
            const updatedWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
            await tx.walletLedger.create({
                data: {
                    walletId: wallet.id,
                    type: 'CREDIT',
                    amount: amount,
                    balanceAfter: updatedWallet!.balance,
                    description: `Referral reward — friend's first order completed`,
                    referenceType: 'REFERRAL',
                    referenceId: bookingId
                }
            });

            console.log(`[Referral] First-order bonus ₹${amount} credited to referrer ${referrerId} (booking ${bookingId})`);
        });
    } catch (error: any) {
        if (error.code === 'P2002') {
            console.log(`[Referral] Duplicate first-order bonus prevented for user ${userId}`);
            return;
        }
        console.error('[Referral] Error awarding first-order bonus:', error.message);
        // Non-critical: booking confirmation should still succeed
    }
}
