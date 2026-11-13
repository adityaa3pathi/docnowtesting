import { afterEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { realConsultVideo } from './consultations.video';

describe('LiveKit join tokens', () => {
    afterEach(() => {
        process.env.LIVEKIT_URL = '';
        process.env.LIVEKIT_API_KEY = '';
        process.env.LIVEKIT_API_SECRET = '';
    });
    const setKeys = () => {
        process.env.LIVEKIT_URL = 'wss://docnow-test.livekit.cloud';
        process.env.LIVEKIT_API_KEY = 'APItest';
        process.env.LIVEKIT_API_SECRET = 'secret-secret-secret-secret-secret';
    };

    it('limits audio bookings to the microphone and names the person', async () => {
        setKeys();
        const token = await realConsultVideo().joinToken('consult-1', 'user-1', 'Ravi', 'patient-audio');
        const claims = jwt.verify(token, 'secret-secret-secret-secret-secret') as any;
        expect(claims).toMatchObject({ sub: 'user-1', name: 'Ravi', iss: 'APItest' });
        expect(claims.video).toMatchObject({ room: 'consult-1', roomJoin: true, canPublish: true, canPublishData: false });
        expect(claims.video.canPublishSources).toEqual(['microphone']);
        expect(claims.exp - claims.nbf).toBe(2 * 3600);
    });

    it('allows camera and microphone for video bookings', async () => {
        setKeys();
        const claims = jwt.decode(await realConsultVideo().joinToken('consult-1', 'doc-1', 'Dr. A', 'doctor')) as any;
        expect(claims.video.canPublishSources.sort()).toEqual(['camera', 'microphone']);
    });

    it('reports video as not set up without keys', async () => {
        await expect(realConsultVideo().joinToken('r', 'u', 'n', 'doctor')).rejects.toMatchObject({ status: 503 });
    });
});
