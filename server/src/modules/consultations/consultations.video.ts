/**
 * 100ms video. The server makes rooms and signs short-lived join tokens; the keys never leave it.
 * The 100ms template must define the roles in VideoRole.
 */
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { DoctorError } from './doctors.status';

export type VideoRole = 'doctor' | 'patient' | 'doctor-audio' | 'patient-audio';

export interface ConsultVideo {
    createRoom(name: string): Promise<string>;
    joinToken(roomId: string, userId: string, role: VideoRole): string;
}

const HMS_API = 'https://api.100ms.live/v2';
const JOIN_TOKEN_TTL = '2h';

function hmsKeys() {
    const accessKey = process.env.HMS_ACCESS_KEY;
    const secret = process.env.HMS_SECRET;
    const templateId = process.env.HMS_TEMPLATE_ID;
    if (!accessKey || !secret || !templateId) throw new DoctorError(503, 'Video calls are not set up yet');
    return { accessKey, secret, templateId };
}

function managementToken(accessKey: string, secret: string) {
    return jwt.sign({ access_key: accessKey, type: 'management', version: 2 }, secret, {
        algorithm: 'HS256', expiresIn: '5m', jwtid: randomUUID(),
    });
}

export function realConsultVideo(): ConsultVideo {
    return {
        async createRoom(name) {
            const { accessKey, secret, templateId } = hmsKeys();
            const res = await fetch(`${HMS_API}/rooms`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${managementToken(accessKey, secret)}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, template_id: templateId }),
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) throw new Error(`100ms create room failed: HTTP ${res.status}`);
            const room = (await res.json()) as { id?: string };
            if (!room.id) throw new Error('100ms create room returned no id');
            return room.id;
        },
        joinToken(roomId, userId, role) {
            const { accessKey, secret } = hmsKeys();
            return jwt.sign({ access_key: accessKey, room_id: roomId, user_id: userId, role, type: 'app', version: 2 }, secret, {
                algorithm: 'HS256', expiresIn: JOIN_TOKEN_TTL, jwtid: randomUUID(),
            });
        },
    };
}
