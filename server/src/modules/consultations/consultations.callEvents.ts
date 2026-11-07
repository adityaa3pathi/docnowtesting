/**
 * The call screen reports its own failures: LiveKit never connected, the room dropped, or the
 * camera/mic would not start. Without this the server only ever sees successful joins.
 */
import { Request, Response, Router } from 'express';
import { TokenVerifier } from 'livekit-server-sdk';
import { z } from 'zod';
import { rateLimiter } from '../../middleware/rateLimiter';
import { logBusinessEvent } from '../../utils/logger';
import { sendConsultError } from './consultations.http';
import { DoctorError } from './doctors.status';

const callEventSchema = z.object({
    token: z.string().min(20).max(4096),
    event: z.enum(['connect_failed', 'disconnected', 'media_failed', 'reconnected']),
    reason: z.string().trim().max(200).optional(),
}).strict();

// A drop in the last minutes of a 2h call (JOIN_TOKEN_TTL) is reported after the token expired,
// so allow a bounded grace past `exp`. Signature and issuer still have to match.
const EXPIRY_GRACE_SECONDS = 15 * 60;

const IDENTITY = /^(doctor|patient|caretaker):[A-Za-z0-9_-]{1,64}$/;

/**
 * The join token is the credential: only someone the server let into the room holds one.
 * Identity and room come from the signed claims, never from the body.
 */
async function verifiedCaller(token: string) {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) throw new DoctorError(503, 'Video calls are not set up yet');

    let identity = '';
    let room = '';
    try {
        const claims = await new TokenVerifier(apiKey, apiSecret).verify(token, EXPIRY_GRACE_SECONDS);
        identity = typeof claims.sub === 'string' ? claims.sub : '';
        room = typeof claims.video?.room === 'string' ? claims.video.room : '';
    } catch {
        throw new DoctorError(401, 'Not allowed');
    }
    if (!IDENTITY.test(identity) || !room || room.length > 128) throw new DoctorError(401, 'Not allowed');
    return { identity, room };
}

export const consultCallEventRoutes = Router();

// No CSRF guard: the credential is the join token in the body, which a cross-site page cannot
// read, and the route changes nothing. Patient, doctor and zero-login guest all use it.
consultCallEventRoutes.post('/call-events', rateLimiter(30, 60, 'consult_call_event'), async (req: Request, res: Response) => {
    try {
        const parse = callEventSchema.safeParse(req.body ?? {});
        if (!parse.success) return res.status(400).json({ error: 'Invalid call event' });
        const { event, reason } = parse.data;

        const { identity, room } = await verifiedCaller(parse.data.token);
        logBusinessEvent('consult_call_event', { callEvent: event, identity, room, reason }, event === 'reconnected' ? 'info' : 'warn');
        res.status(204).end();
    } catch (e) { sendConsultError(res, e, '[Consult]'); }
});
