import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { getClientIP } from '../../utils/adminHelpers';

/**
 * POST /api/admin/wallets/adjust — Credit/Debit user wallet
 */
export async function adjustWallet(req: AuthRequest, res: Response) {
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

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { wallet: true }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Ensure user has a wallet
        let wallet = user.wallet;
        if (!wallet) {
            wallet = await prisma.wallet.create({ data: { userId } });
        }

        const clientIP = getClientIP(req);

        // Perform transaction
        const result = await prisma.$transaction(async (tx) => {
            const signedAmount = type === 'CREDIT' ? numericAmount : -numericAmount;

            const currentBalance = await tx.walletLedger.aggregate({
                where: { walletId: wallet!.id },
                _sum: { amount: true }
            });
            const balance = currentBalance._sum.amount || 0;

            if (type === 'DEBIT' && balance < numericAmount) {
                throw new Error('Insufficient wallet balance');
            }

            const newBalance = balance + signedAmount;

            const ledgerEntry = await tx.walletLedger.create({
                data: {
                    walletId: wallet!.id,
                    type: type,
                    amount: signedAmount,
                    balanceAfter: newBalance,
                    description: reason,
                    referenceType: 'ADMIN_ADJUSTMENT',
                    referenceId: `ADMIN-${Date.now()}`,
                    createdById: req.adminId,
                    ipAddress: clientIP
                }
            });

            // Sync cached Wallet.balance (critical for frontend reads)
            await tx.wallet.update({
                where: { id: wallet!.id },
                data: { balance: newBalance }
            });

            await tx.adminAuditLog.create({
                data: {
                    adminId: req.adminId!,
                    adminName: req.adminName || 'Admin',
                    action: 'WALLET_ADJUSTMENT',
                    entity: 'Wallet',
                    targetId: wallet!.id,
                    oldValue: { balance },
                    newValue: { balance: newBalance, amount: signedAmount, reason },
                    ipAddress: clientIP,
                    isDestructive: type === 'DEBIT'
                }
            });

            return { ledgerEntry, newBalance };
        });

        res.json({ success: true, ...result });

    } catch (error: any) {
        console.error('[Admin] Error adjusting wallet:', error);
        res.status(400).json({ error: error.message || 'Failed to adjust wallet' });
    }
}

/**
 * GET /api/admin/wallets/ledger — System-wide ledger
 */
export async function getWalletLedger(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const type = req.query.type as string;
        const search = req.query.search as string;

        const where: any = {};

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

        const ledger = await prisma.walletLedger.findMany({
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

        const total = await prisma.walletLedger.count({ where });

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
            adminId: entry.createdById
        }));

        res.json({
            ledger: formatted,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });

    } catch (error) {
        console.error('[Admin] Error fetching wallet ledger:', error);
        res.status(500).json({ error: 'Failed to fetch wallet ledger' });
    }
}
