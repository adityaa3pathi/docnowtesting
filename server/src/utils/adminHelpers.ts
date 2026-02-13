import { AuthRequest } from '../middleware/auth';

/**
 * Extract client IP address from request headers.
 * Handles X-Forwarded-For (proxy/load-balancer) and direct connections.
 */
export function getClientIP(req: AuthRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded)) {
        return forwarded[0] || 'unknown';
    }
    return req.socket?.remoteAddress || 'unknown';
}
