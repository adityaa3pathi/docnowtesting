import { prisma } from '../db';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined');

// 15 minutes for access token
const ACCESS_TOKEN_EXPIRY = '15m';
// 30 days for refresh token
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
// Maximum active sessions per user
const MAX_SESSIONS_PER_USER = 5;

interface TokenPayload {
    userId: string;
    mobile: string;
    sessionId: string;
    tokenVersion: number;
}

/**
 * Hash an opaque token for DB storage (never store raw tokens)
 */
function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Enforce max sessions per user by evicting the oldest active session
 */
async function enforceMaxSessions(userId: string) {
    const activeSessions = await prisma.session.findMany({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true }
    });

    if (activeSessions.length >= MAX_SESSIONS_PER_USER) {
        const sessionsToRevoke = activeSessions.slice(0, activeSessions.length - MAX_SESSIONS_PER_USER + 1);
        await prisma.session.updateMany({
            where: { id: { in: sessionsToRevoke.map(s => s.id) } },
            data: { revokedAt: new Date() }
        });
    }
}

/**
 * Creates a brand new session (Login / Signup)
 */
export async function createSession(userId: string, mobile: string, ipAddress?: string, userAgent?: string, clientType: string = 'web') {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
    if (!user) throw new Error('User not found');

    await enforceMaxSessions(userId);

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const familyId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    const session = await prisma.session.create({
        data: {
            userId,
            refreshTokenHash: hashToken(rawRefreshToken),
            familyId,
            expiresAt,
            ipAddress,
            userAgent,
            clientType
        }
    });

    const accessToken = jwt.sign(
        { userId, mobile, sessionId: session.id, tokenVersion: user.tokenVersion } as TokenPayload,
        JWT_SECRET as string,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    const csrfToken = crypto.randomBytes(32).toString('hex');

    return { accessToken, refreshToken: rawRefreshToken, csrfToken, sessionId: session.id };
}

/**
 * Rotates an existing refresh token.
 * Includes token reuse detection: if a revoked token is used, revokes the entire family.
 */
export async function rotateRefreshToken(oldRefreshToken: string, ipAddress?: string, userAgent?: string) {
    const hash = hashToken(oldRefreshToken);
    
    const oldSession = await prisma.session.findFirst({
        where: { refreshTokenHash: hash },
        include: { user: { select: { mobile: true, tokenVersion: true, status: true } } }
    });

    if (!oldSession) {
        throw new Error('Invalid refresh token');
    }

    if (oldSession.user.status === 'BLOCKED') {
        throw new Error('Account is blocked');
    }

    // Token Reuse Detection
    if (oldSession.revokedAt) {
        console.warn(`[AUTH] Token Reuse Detected! Revoking entire family for user ${oldSession.userId}`);
        await revokeFamily(oldSession.familyId);
        throw new Error('Invalid refresh token - Session revoked');
    }

    if (new Date() > oldSession.expiresAt) {
        throw new Error('Refresh token expired');
    }

    // Token is valid. Rotate it.
    const newRawRefreshToken = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    // Transaction to safely rotate
    const [newSession, _] = await prisma.$transaction([
        prisma.session.create({
            data: {
                userId: oldSession.userId,
                refreshTokenHash: hashToken(newRawRefreshToken),
                familyId: oldSession.familyId,
                expiresAt,
                ipAddress,
                userAgent,
                clientType: oldSession.clientType
            }
        }),
        prisma.session.update({
            where: { id: oldSession.id },
            data: { revokedAt: new Date() } // Soft revoke old token
        })
    ]);

    // Link the rotation chain (needs to happen after new session is created to have its ID)
    await prisma.session.update({
        where: { id: oldSession.id },
        data: { replacedById: newSession.id }
    });

    const accessToken = jwt.sign(
        { 
            userId: oldSession.userId, 
            mobile: oldSession.user.mobile, 
            sessionId: newSession.id, 
            tokenVersion: oldSession.user.tokenVersion 
        } as TokenPayload,
        JWT_SECRET as string,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    const csrfToken = crypto.randomBytes(32).toString('hex');

    return { accessToken, refreshToken: newRawRefreshToken, csrfToken, sessionId: newSession.id };
}

export async function revokeSession(sessionId: string) {
    await prisma.session.updateMany({
        where: { id: sessionId },
        data: { revokedAt: new Date() }
    });
}

export async function revokeAllUserSessions(userId: string) {
    await prisma.$transaction([
        prisma.session.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() }
        }),
        prisma.user.update({
            where: { id: userId },
            data: { tokenVersion: { increment: 1 } }
        })
    ]);
}

export async function revokeFamily(familyId: string) {
    await prisma.session.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() }
    });
}

export async function cleanExpiredSessions() {
    await prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } }
    });
}
