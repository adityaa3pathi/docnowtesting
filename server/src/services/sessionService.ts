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

/** Two tabs (or a retried request) refreshed with the same token; the other one already won. */
export class RefreshRaceError extends Error {
    constructor() {
        super('Session already refreshed');
    }
}

// A revoked token seen this soon after its own rotation is a parallel refresh, not a stolen token.
const ROTATION_GRACE_MS = 30_000;

/**
 * Rotates a refresh token atomically: only one caller can revoke the old session, so a race can
 * never mint two live tokens. Reuse of a token rotated long ago revokes the whole family.
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

    if (oldSession.revokedAt) {
        const justRotated = !!oldSession.replacedById && Date.now() - oldSession.revokedAt.getTime() < ROTATION_GRACE_MS;
        if (justRotated) throw new RefreshRaceError();
        console.warn(`[AUTH] Token Reuse Detected! Revoking entire family for user ${oldSession.userId}`);
        await revokeFamily(oldSession.familyId);
        throw new Error('Invalid refresh token - Session revoked');
    }

    if (new Date() > oldSession.expiresAt) {
        throw new Error('Refresh token expired');
    }

    const newRawRefreshToken = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    const newSession = await prisma.$transaction(async (tx) => {
        const created = await tx.session.create({
            data: {
                userId: oldSession.userId,
                refreshTokenHash: hashToken(newRawRefreshToken),
                familyId: oldSession.familyId,
                expiresAt,
                ipAddress,
                userAgent,
                clientType: oldSession.clientType
            }
        });
        // The conditional update is the lock: a parallel rotation finds count 0 and rolls back.
        const claimed = await tx.session.updateMany({
            where: { id: oldSession.id, revokedAt: null },
            data: { revokedAt: new Date(), replacedById: created.id }
        });
        if (claimed.count !== 1) throw new RefreshRaceError();
        return created;
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
