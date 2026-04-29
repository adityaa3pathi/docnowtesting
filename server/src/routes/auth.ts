import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createSession, rotateRefreshToken, revokeSession, revokeAllUserSessions } from '../services/sessionService';
import { setAuthResponse, clearAuthCookies, isWebClient } from '../utils/cookieHelpers';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { generateReferralCode, awardSignupBonus } from '../utils/referralService';
import { OTP_EXPIRY_MINS, isValidMobile, persistAndSendOtp } from '../services/otp';

const router = express.Router();

// Redis setup for rate limiting (Optional/Upstash)
const redis = process.env.UPSTASH_REDIS_REST_URL
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
}
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

import { rateLimiter } from '../middleware/rateLimiter';
// 5 requests per 15 minutes for OTP endpoints
const authRateLimiter = rateLimiter(5, 15 * 60, 'auth_otp');
const verifyRateLimiter = rateLimiter(10, 15 * 60, 'auth_verify_otp');

// --- SIGNUP FLOW ---

// POST /api/auth/signup/send-otp
router.post('/signup/send-otp', authRateLimiter, async (req: Request, res: Response) => {
    try {
        const { mobile, email } = req.body;

        if (!mobile || !isValidMobile(mobile)) {
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

        await persistAndSendOtp(mobile, 'signup');
        res.status(200).json({ message: 'OTP sent successfully', expiry: OTP_EXPIRY_MINS });

    } catch (error: any) {
        console.error('Signup OTP Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// POST /api/auth/signup/verify
router.post('/signup/verify', verifyRateLimiter, async (req: Request, res: Response) => {
    try {
        const { mobile, code, password, age, name, email, gender, referralCode: appliedCode } = req.body;

        if (!mobile || !code || !password || !age || !name || !gender) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate Name (no numbers)
        if (/\d/.test(name)) {
            return res.status(400).json({ error: 'Name cannot contain numbers' });
        }

        // Validate Age
        const parsedAge = parseInt(age);
        if (isNaN(parsedAge) || parsedAge <= 0 || parsedAge > 120) {
            return res.status(400).json({ error: 'Invalid age provided' });
        }

        // Validate Gender
        if (!['Male', 'Female', 'Other'].includes(gender)) {
            return res.status(400).json({ error: 'Invalid gender provided' });
        }

        // Verify OTP
        const otpRecord = await prisma.oTP.findUnique({ where: { identifier: mobile } });
        if (!otpRecord || new Date() > otpRecord.expiresAt || otpRecord.code !== code) {
            return res.status(400).json({ error: 'Invalid or Expired OTP' });
        }

        // Resolve referrer (if code provided)
        let referrerId: string | null = null;
        if (appliedCode) {
            const trimmedCode = appliedCode.trim().toUpperCase();
            const referrer = await prisma.user.findFirst({
                where: { referralCode: trimmedCode }
            });
            if (!referrer) {
                return res.status(400).json({ error: 'Invalid referral code', code: 'INVALID_REFERRAL' });
            }
            referrerId = referrer.id;
        }

        // Create User with referral code + referrer link
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                mobile,
                password: hashedPassword,
                age: parsedAge,
                gender: gender,
                name: name,
                email: email || null,
                isVerified: true,
                referralCode: generateReferralCode(name),
                referredById: referrerId
            }
        });

        // Create wallet for new user
        await prisma.wallet.create({ data: { userId: newUser.id } });

        // Award signup bonus (non-blocking — signup succeeds even if reward fails)
        if (referrerId) {
            awardSignupBonus(referrerId, newUser.id).catch(err =>
                console.error('[Auth] Signup bonus failed (non-blocking):', err.message)
            );
        }

        // Cleanup OTP
        await prisma.oTP.delete({ where: { identifier: mobile } });

        // Issue Dual-Mode Token
        const clientType = req.headers['x-client-type'] === 'mobile' ? 'mobile' : 'web';
        const session = await createSession(newUser.id, newUser.mobile, req.ip, req.headers['user-agent'], clientType);
        
        setAuthResponse(req, res, session, {
            id: newUser.id,
            name: newUser.name,
            mobile: newUser.mobile,
            email: newUser.email,
            referralCode: newUser.referralCode
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

        const clientType = req.headers['x-client-type'] === 'mobile' ? 'mobile' : 'web';
        const session = await createSession(user.id, user.mobile, req.ip, req.headers['user-agent'], clientType);

        setAuthResponse(req, res, session, { id: user.id, name: user.name, mobile: user.mobile, email: user.email, role: user.role });

    } catch (error) {
        console.error('Login Password Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/auth/login/send-otp
router.post('/login/send-otp', authRateLimiter, async (req: Request, res: Response) => {
    try {
        const { mobile } = req.body;
        if (!mobile || !isValidMobile(mobile)) return res.status(400).json({ error: 'Valid 10-digit mobile number required' });

        const user = await prisma.user.findUnique({ where: { mobile } });
        if (!user) return res.status(404).json({ error: 'User does not exist. Please Signup.' });

        await persistAndSendOtp(mobile, 'login');
        res.status(200).json({ message: 'OTP sent successfully', expiry: OTP_EXPIRY_MINS });

    } catch (error: any) {
        console.error('Login OTP Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// POST /api/auth/login/verify-otp
router.post('/login/verify-otp', verifyRateLimiter, async (req: Request, res: Response) => {
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

        const clientType = req.headers['x-client-type'] === 'mobile' ? 'mobile' : 'web';
        const session = await createSession(user.id, user.mobile, req.ip, req.headers['user-agent'], clientType);

        setAuthResponse(req, res, session, { id: user.id, name: user.name, mobile: user.mobile, email: user.email, role: user.role });

    } catch (error) {
        console.error('Login Verify OTP Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// --- FORGOT PASSWORD FLOW ---

// POST /api/auth/forgot-password/send-otp
router.post('/forgot-password/send-otp', authRateLimiter, async (req: Request, res: Response) => {
    try {
        const { mobile } = req.body;

        if (!mobile || !isValidMobile(mobile)) {
            return res.status(400).json({ error: 'Valid 10-digit mobile number is required' });
        }

        const user = await prisma.user.findUnique({ where: { mobile } });
        if (!user) return res.status(404).json({ error: 'No account found with this mobile number.' });

        // Resend cooldown — prevent OTP spam
        const existing = await prisma.oTP.findUnique({ where: { identifier: mobile } });
        if (existing) {
            const secondsSinceLastSend = (Date.now() - existing.updatedAt.getTime()) / 1000;
            if (secondsSinceLastSend < RESEND_COOLDOWN_SECONDS) {
                const waitTime = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLastSend);
                return res.status(429).json({
                    error: `Please wait ${waitTime}s before requesting a new code`,
                    retryAfter: waitTime
                });
            }
        }

        await persistAndSendOtp(mobile, 'forgot_password');
        res.status(200).json({ message: 'Reset OTP sent successfully', expiry: OTP_EXPIRY_MINS });
    } catch (error: any) {
        console.error('Forgot Password Send OTP Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// POST /api/auth/forgot-password/verify-reset
router.post('/forgot-password/verify-reset', verifyRateLimiter, async (req: Request, res: Response) => {
    try {
        const { mobile, code, newPassword } = req.body;

        if (!mobile || !code || !newPassword) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Password strength: min 6 chars, at least one letter and one digit
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
            return res.status(400).json({ error: 'Password must contain at least one letter and one number' });
        }

        const otpRecord = await prisma.oTP.findUnique({ where: { identifier: mobile } });

        if (!otpRecord) {
            return res.status(400).json({ error: 'No reset request found. Please request a new code.' });
        }

        if (new Date() > otpRecord.expiresAt) {
            await prisma.oTP.delete({ where: { identifier: mobile } });
            return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
        }

        // Track verification attempts — lockout after MAX_OTP_ATTEMPTS
        if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
            await prisma.oTP.delete({ where: { identifier: mobile } });
            return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
        }

        if (otpRecord.code !== code) {
            // Increment attempt counter
            await prisma.oTP.update({
                where: { identifier: mobile },
                data: { attempts: { increment: 1 } }
            });
            const remaining = MAX_OTP_ATTEMPTS - otpRecord.attempts - 1;
            return res.status(400).json({
                error: `Invalid code. ${remaining > 0 ? `${remaining} attempt${remaining > 1 ? 's' : ''} remaining.` : 'Please request a new code.'}`
            });
        }

        // OTP valid — reset password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { mobile },
            data: { password: hashedPassword }
        });

        await prisma.oTP.delete({ where: { identifier: mobile } });

        console.log(`[AUTH-RESET] Password reset successful for ${mobile}`);
        res.status(200).json({ message: 'Password reset successfully. Please login with your new password.' });

    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- SESSION MANAGEMENT ---

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
    try {
        const refreshToken = isWebClient(req)
            ? req.cookies?.docnow_refresh
            : req.body.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token missing' });
        }

        const session = await rotateRefreshToken(refreshToken, req.ip, req.headers['user-agent']);
        setAuthResponse(req, res, session, null); // Do not send user data on refresh to save payload
    } catch (error: any) {
        console.error('Refresh Token Error:', error.message);
        clearAuthCookies(res);
        res.status(401).json({ error: error.message || 'Invalid session' });
    }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        // Find session ID from token payload
        let token = req.cookies?.docnow_access;
        if (!token) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.split(' ')[1];
            }
        }
        
        if (token) {
            const decoded = jwt.decode(token) as { sessionId?: string };
            if (decoded?.sessionId) {
                await revokeSession(decoded.sessionId);
            }
        }
        
        clearAuthCookies(res);
        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/auth/logout-all
router.post('/logout-all', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
        
        await revokeAllUserSessions(req.userId);
        clearAuthCookies(res);
        res.status(200).json({ success: true, message: 'Logged out from all devices' });
    } catch (error) {
        console.error('Logout All Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
        
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: { id: true, name: true, mobile: true, email: true, role: true, isVerified: true, referralCode: true }
        });
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        res.status(200).json({ user });
    } catch (error) {
        console.error('Get Me Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
