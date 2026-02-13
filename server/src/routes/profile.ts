import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

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
        const { name, email, gender, age } = req.body;

        // Validate at least one field is provided
        if (!name && !email && !gender && !age) {
            res.status(400).json({ error: 'At least one field to update is required' });
            return;
        }

        const updateData: any = {};
        if (name) updateData.name = name;
        if (gender) updateData.gender = gender;
        if (age) updateData.age = parseInt(age);
        if (email) {
            // Check if email is already taken by another user
            const existingUser = await prisma.user.findUnique({
                where: { email }
            });
            if (existingUser && existingUser.id !== req.userId) {
                res.status(409).json({ error: 'Email already in use' });
                return;
            }
            updateData.email = email;
        }

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

export default router;
