import { AuthRequest } from '../middleware/auth';

/** Client IP for audit logs. req.ip honours "trust proxy"; the raw header is caller-controlled. */
export function getClientIP(req: AuthRequest): string {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}
