import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const router = express.Router();
const prisma = new PrismaClient();

// Redis setup for rate limiting (Optional/Upstash)
const redis = process.env.UPSTASH_REDIS_REST_URL
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null;

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';
const OTP_EXPIRY_MINS = 5;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

// Helper: Generate OTP
const generateOTP = () => crypto.randomInt(100000, 999999).toString();

// --- SIGNUP FLOW ---

// POST /api/auth/signup/send-otp
router.post('/signup/send-otp', async (req: Request, res: Response) => {
    try {
        const { mobile, email } = req.body;

        if (!mobile || mobile.length !== 10) {
            return res.status(400).json({ error: 'Valid 10-digit Mobile Number is required' });
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({ where: { mobile } });
        if (existingUser) {
            return res.status(409).json({ error: 'User with this mobile number already exists. Please login.' });
        }

        if (email) {
            const existingEmail = await prisma.user.findUnique({ where: { email } });
            if (existingEmail) {
                return res.status(409).json({ error: 'User with this email already exists.' });
            }
        }

        // Generate & Save OTP (Purpose: SIGNUP)
        // ideally we should store purpose in OTP table, but for now specific flow logic handles it
        const code = generateOTP();
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINS * 60 * 1000);

        await prisma.oTP.upsert({
            where: { identifier: mobile },
            update: { code, expiresAt, attempts: 0, updatedAt: new Date() },
            create: { identifier: mobile, code, expiresAt, attempts: 0 }
        });

        console.log(`[AUTH-SIGNUP] OTP for ${mobile}: ${code}`);
        res.status(200).json({ message: 'OTP sent successfully', expiry: OTP_EXPIRY_MINS });

    } catch (error) {
        console.error('Signup OTP Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/auth/signup/verify
router.post('/signup/verify', async (req: Request, res: Response) => {
    try {
        const { mobile, code, password, age, name, email } = req.body;

        if (!mobile || !code || !password || !age) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify OTP
        const otpRecord = await prisma.oTP.findUnique({ where: { identifier: mobile } });
        if (!otpRecord || new Date() > otpRecord.expiresAt || otpRecord.code !== code) {
            return res.status(400).json({ error: 'Invalid or Expired OTP' });
        }

        // Create User
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                mobile,
                password: hashedPassword,
                age: parseInt(age),
                name: name || null,
                email: email || null,
                isVerified: true
            }
        });

        // Cleanup OTP
        await prisma.oTP.delete({ where: { identifier: mobile } });

        // Issue Token
        const token = jwt.sign({ userId: newUser.id, mobile: newUser.mobile }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: { id: newUser.id, name: newUser.name, mobile: newUser.mobile, email: newUser.email }
        });

    } catch (error) {
        console.error('Signup Verify Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// --- LOGIN FLOW ---

// POST /api/auth/login/password
router.post('/login/password', async (req: Request, res: Response) => {
    try {
        const { mobile, password } = req.body;

        if (!mobile || !password) return res.status(400).json({ error: 'Mobile and Password required' });

        const user = await prisma.user.findUnique({ where: { mobile } });
        if (!user || !user.password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, mobile: user.mobile }, JWT_SECRET, { expiresIn: '7d' });

        res.status(200).json({
            message: 'Login successful',
            token,
            user: { id: user.id, name: user.name, mobile: user.mobile, email: user.email, role: user.role }
        });

    } catch (error) {
        console.error('Login Password Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/auth/login/send-otp
router.post('/login/send-otp', async (req: Request, res: Response) => {
    try {
        const { mobile } = req.body;
        if (!mobile) return res.status(400).json({ error: 'Mobile number required' });

        const user = await prisma.user.findUnique({ where: { mobile } });
        if (!user) return res.status(404).json({ error: 'User does not exist. Please Signup.' });

        const code = generateOTP();
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINS * 60 * 1000);

        await prisma.oTP.upsert({
            where: { identifier: mobile },
            update: { code, expiresAt, attempts: 0, updatedAt: new Date() },
            create: { identifier: mobile, code, expiresAt, attempts: 0 }
        });

        console.log(`[AUTH-LOGIN] OTP for ${mobile}: ${code}`);
        res.status(200).json({ message: 'OTP sent successfully', expiry: OTP_EXPIRY_MINS });

    } catch (error) {
        console.error('Login OTP Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/auth/login/verify-otp
router.post('/login/verify-otp', async (req: Request, res: Response) => {
    try {
        const { mobile, code } = req.body;

        const otpRecord = await prisma.oTP.findUnique({ where: { identifier: mobile } });
        if (!otpRecord || new Date() > otpRecord.expiresAt || otpRecord.code !== code) {
            return res.status(400).json({ error: 'Invalid or Expired OTP' });
        }

        const user = await prisma.user.findUnique({ where: { mobile } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Update verification status if needed
        if (!user.isVerified) {
            await prisma.user.update({ where: { id: user.id }, data: { isVerified: true } });
        }

        await prisma.oTP.delete({ where: { identifier: mobile } });

        const token = jwt.sign({ userId: user.id, mobile: user.mobile }, JWT_SECRET, { expiresIn: '7d' });

        res.status(200).json({
            message: 'Login successful',
            token,
            user: { id: user.id, name: user.name, mobile: user.mobile, email: user.email }
        });

    } catch (error) {
        console.error('Login Verify OTP Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// --- FORGOT PASSWORD FLOW ---

// POST /api/auth/forgot-password/send-otp
router.post('/forgot-password/send-otp', async (req: Request, res: Response) => {
    // Reuse Login OTP logic, just technically semantic separation
    // We can just verify user exists and send OTP
    try {
        const { mobile } = req.body;
        const user = await prisma.user.findUnique({ where: { mobile } });
        if (!user) return res.status(404).json({ error: 'User does not exist.' });

        const code = generateOTP();
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINS * 60 * 1000);

        await prisma.oTP.upsert({
            where: { identifier: mobile },
            update: { code, expiresAt, attempts: 0, updatedAt: new Date() },
            create: { identifier: mobile, code, expiresAt, attempts: 0 }
        });

        console.log(`[AUTH-RESET] OTP for ${mobile}: ${code}`);
        res.status(200).json({ message: 'Reset OTP sent successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/auth/forgot-password/verify-reset
router.post('/forgot-password/verify-reset', async (req: Request, res: Response) => {
    try {
        const { mobile, code, newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password too short' });

        const otpRecord = await prisma.oTP.findUnique({ where: { identifier: mobile } });
        if (!otpRecord || new Date() > otpRecord.expiresAt || otpRecord.code !== code) {
            return res.status(400).json({ error: 'Invalid or Expired OTP' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { mobile },
            data: { password: hashedPassword }
        });

        await prisma.oTP.delete({ where: { identifier: mobile } });

        res.status(200).json({ message: 'Password reset successfully. Please login.' });

    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Legacy/Compatibility Routes (Optional: remove if fully breaking)
// Keeping send-otp generic for now if needed, but client should use specific endpoints.

export default router;
